/* jslint node: true */
'use strict';

//  ENiGMA½
const { MenuModule }    = require('./menu_module.js');
const UserProps         = require('./user_property.js');
const UserLogNames      = require('./user_log_name.js');
const { Errors }        = require('./enig_error.js');
const UserDb            = require('./database.js').dbs.user;
const SysDb             = require('./database.js').dbs.system;
const User              = require('./user.js');
const stringFormat          = require('./string_format.js');

//  deps
const _                 = require('lodash');
const async             = require('async');

exports.moduleInfo = {
    name        : 'TopX',
    desc        : 'Displays users top X stats',
    author      : 'NuSkooler',
    packageName : 'codes.l33t.enigma.topx',
};

const FormIds = {
    menu    : 0,
};

exports.getModule = class TopXModule extends MenuModule {
    constructor(options) {
        super(options);
        this.config = Object.assign({}, _.get(options, 'menuConfig.config'), { extraArgs : options.extraArgs });
    }

    mciReady(mciData, cb) {
        super.mciReady(mciData, err => {
            if(err) {
                return cb(err);
            }

            async.series(
                [
                    (callback) => {
                        const userPropValues    = _.values(UserProps);
                        const userLogValues     = _.values(UserLogNames);

                        return this.validateConfigFields(
                            {
                                mciMap  : (key, config) => {
                                    const mciCodes = Object.keys(config.mciMap).map(mci => {
                                        return parseInt(mci);
                                    }).filter(mci => !isNaN(mci));
                                    if(0 === mciCodes.length) {
                                        return false;
                                    }
                                    return mciCodes.every(mci => {
                                        const o = config.mciMap[mci];
                                        if(!_.isObject(o)) {
                                            return false;
                                        }
                                        const type = o.type;
                                        switch(type) {
                                            case 'userProp' :
                                                if(!userPropValues.includes(o.propName)) {
                                                    return false;
                                                }
                                                //  VM# must exist for this mci
                                                if(!_.isObject(mciData, [ 'menu', `VM${mci}` ])) {
                                                    return false;
                                                }
                                                break;

                                            case 'userEventLog' :
                                                if(!userLogValues.includes(o.logName)) {
                                                    return false;
                                                }
                                                //  VM# must exist for this mci
                                                if(!_.isObject(mciData, [ 'menu', `VM${mci}` ])) {
                                                    return false;
                                                }
                                                break;

                                            default :
                                                return false;
                                        }
                                        return true;
                                    });
                                }
                            },
                            callback
                        );
                    },
                    (callback) => {
                        return this.prepViewController('menu', FormIds.menu, mciData.menu, callback);
                    },
                    (callback) => {
                        async.forEachSeries(Object.keys(this.config.mciMap), (mciCode, nextMciCode) => {
                            return this.populateTopXList(mciCode, nextMciCode);
                        },
                        err => {
                            return callback(err);
                        });
                    }
                ],
                err => {
                    return cb(err);
                }
            );
        });
    }

    populateTopXList(mciCode, cb) {
        const listView = this.viewControllers.menu.getView(mciCode);
        if(!listView) {
            return cb(Errors.UnexpectedState(`Failed to get view for MCI ${mciCode}`));
        }

        const type = this.config.mciMap[mciCode].type;        
        switch(type) {
            case 'userProp'     : return this.populateTopXUserProp(listView, mciCode, cb);
            case 'userEventLog' : return this.populateTopXUserEventLog(listView, mciCode, cb);

            //  we should not hit here; validation happens up front
            default         : return cb(Errors.UnexpectedState(`Unexpected type: ${type}`));
        }
    }

    rowsToItems(rows, cb) {
        async.map(rows, (row, nextRow) => {
            this.loadUserInfo(row.user_id, (err, userInfo) => {
                if(err) {
                    return nextRow(err);
                }
                return nextRow(null, Object.assign(userInfo, { value : row.value }));
            });
        },
        (err, items) => {
            return cb(err, items);
        });
    }

    populateTopXUserEventLog(listView, mciCode, cb) {
        const count = listView.dimens.height || 1;
        const daysBack = this.config.mciMap[mciCode].daysBack;
        const whereDate = daysBack ? `AND DATETIME(timestamp) >= DATETIME('now', '-${daysBack} days')` : '';

        SysDb.all(
            `SELECT user_id, SUM(CASE WHEN typeof(log_value) IS 'text' THEN 1 ELSE CAST(log_value AS INTEGER) END) AS value
            FROM user_event_log
            WHERE log_name = ? ${whereDate}
            GROUP BY user_id
            ORDER BY value DESC
            LIMIT ${count};`,
            [ this.config.mciMap[mciCode].logName ],
            (err, rows) => {
                if(err) {
                    return cb(err);
                }

                this.rowsToItems(rows, (err, items) => {
                    if(err) {
                        return cb(err);
                    }
                    listView.setItems(items);
                    listView.redraw();
                });
            }
        );
    }

    populateTopXUserProp(listView, mciCode, cb) {
        const count = listView.dimens.height || 1;
        UserDb.all(
            `SELECT user_id, CAST(prop_value AS INTEGER) AS value
            FROM user_property
            WHERE prop_name = ?
            ORDER BY value DESC
            LIMIT ${count};`,
            [ this.config.mciMap[mciCode].propName ],
            (err, rows) => {
                if(err) {
                    return cb(err);
                }

                this.rowsToItems(rows, (err, items) => {
                    if(err) {
                        return cb(err);
                    }
                    listView.setItems(items);
                    listView.redraw();
                });
            }
        );
    }

    loadUserInfo(userId, cb) {
        const getPropOpts = {
            names : [ UserProps.RealName, UserProps.Location, UserProps.Affiliations ]
        };

        const userInfo = { userId };
        User.getUserName(userId, (err, userName) => {
            if(err) {
                return cb(err);
            }

            userInfo.userName = userName;

            User.loadProperties(userId, getPropOpts, (err, props) => {
                if(err) {
                    return cb(err);
                }

                userInfo.location   = props[UserProps.Location] || '';
                userInfo.affils     = userInfo.affiliation = props[UserProps.Affiliations] || '';
                userInfo.realName   = props[UserProps.RealName] || '';

                return cb(null, userInfo);
            });
        });
    }
};