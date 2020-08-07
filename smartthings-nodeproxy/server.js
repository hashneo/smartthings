/**
 *  SmartThings Node Proxy (STNP)
 *
 *  Author: redloro@gmail.com
 *
 *  Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 *  in compliance with the License. You may obtain a copy of the License at:
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software distributed under the License is distributed
 *  on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License
 *  for the specific language governing permissions and limitations under the License.
 */

////////////////////
// DO NOT CHANGE BELOW THIS LINE
////////////////////
let express = require('express');
let http = require('http');
let app = express();
let nconf = require('nconf');
let path = require('path');
const bent = require('bent');

nconf.file({file: './data/config.json'});

let logger = function (str) {
    mod = 'stnp';
    console.log("[%s] [%s] %s", new Date().toISOString(), mod, str);
};

/**
 * Root route
 */
app.get('/', function (req, res) {
    res.status(200).json({status: 'SmartThings Node Proxy running'});
});

/**
 * Enforce basic authentication route; verify that HTTP.HEADERS['stnp-auth'] == CONFIG['authCode']
 */
app.use( (req, res, next) => {

    logger(req.ip + ' ' + req.method + ' ' + req.url);

    let headers = req.headers;
    if (!headers['stnp-auth'] ||
        headers['stnp-auth'] !== nconf.get('authCode')) {
        logger('Authentication error');
        res.status(500).json({error: 'Authentication error'});
        return;
    }

    next();
});

/**
 * Subscribe route used by SmartThings Hub to register for callback/notifications and write to config.json
 * @param {String} host - The SmartThings Hub IP address and port number
 */
app.get('/subscribe/:host', (req, res) => {
    let parts = req.params.host.split(":");

    let notify = nconf.get('notify');

    if (!notify)
        notify = [];

    const found = notify.find(element => element.address === parts[0]);

    if (!found){

        notify.push({
            address: parts[0],
            port:parts[1]
        });

        nconf.save( (err) => {
            if (err) {
                logger('Configuration error: ' + err.message);
                res.status(500).json({error: 'Configuration error: ' + err.message});
            }
        });
    }

    res.end();
});

/**
 * Startup
 */
let server = app.listen(nconf.get('port') || 8080, () => {
    logger('SmartThings Node Proxy listening at http://' + server.address().address + ':' + server.address().port);
});

/**
 * Load all plugins
 */
let plugins = nconf.get('plugins');

if (plugins) {
    plugins
        .forEach(function (file) {
            let _p = path.parse(file);
            let plugin = _p.name;
            app.use('/plugins/' + plugin, require('./' + file)(function (data) {
                notify(plugin, data);
            }));
            logger('Loaded plugin: ' + plugin);
        });
}


/**
 * Callback to the SmartThings Hub via HTTP NOTIFY
 * @param {String} plugin - The name of the STNP plugin
 * @param {String} data - The HTTP message body
 */
let notify = function (plugin, data) {

    let notify = nconf.get('notify');

    if (!notify)
        notify = [];

    notify.forEach( ( endPoint ) => {

        if (!endPoint.address || endPoint.address.length === 0 || !endPoint.port || endPoint.port === 0) {
            logger('Notify server address and port not set!');
            return;
        }

        const _notify = bent('NOTIFY', 200);

        let url = `http://${endPoint.address}:${endPoint.port}/notify`;

        let headers = {
            'content-type': 'application/json',
            'connection': 'close',
            'stnp-plugin': plugin
        };

        _notify(url, data, headers)
            .then((res) => {
                if (res.statusCode === 200) {
                    logger(`Info: Endpoint ${endPoint.address} notified`);
                }else{
                    logger(`Info: Endpoint ${endPoint.address} notification failed`);
                }
            })
            .catch((err) => {
                logger('Notify error: ' + err);
            });
    });
};
