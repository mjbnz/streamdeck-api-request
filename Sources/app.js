/* global $SD */
$SD.on('connected', conn => connected(conn));

function connected(jsn) {
    debugLog('Connected Plugin:', jsn);

    $SD.on('com.github.mjbnz.sd-api-request.didReceiveSettings', jsonObj =>
        action.onDidReceiveSettings(jsonObj)
    );
    $SD.on('com.github.mjbnz.sd-api-request.willAppear', jsonObj =>
        action.onWillAppear(jsonObj)
    );
    $SD.on('com.github.mjbnz.sd-api-request.willDisappear', jsonObj =>
        action.onWillDisappear(jsonObj)
    );
    $SD.on('com.github.mjbnz.sd-api-request.keyUp', jsonObj =>
        action.onKeyUp(jsonObj)
    );
}

var action = {
    type: 'com.github.mjbnz.sd-api-request',
    cache: {},

    onDidReceiveSettings: function(jsn) {
        log('onDidReceiveSettings(): ', jsn);

        const settings = jsn.payload.settings;
        const api_request = this.cache[jsn.context];

        if(!settings || !api_request) return;

        api_request.updateSettings(settings);
        this.cache[jsn.context] = api_request;

    },

    onWillAppear: function(jsn) {
        log('onWillAppear(): ', jsn);

        if (!jsn.payload || !jsn.payload.hasOwnProperty('settings')) return;

        const api_request = new APIRequest(jsn);
        this.cache[jsn.context] = api_request;
    },

    onWillDisappear: function(jsn) {
        log('onWillDisappear(): ', jsn);

        let api_request = this.cache[jsn.context];

        if (api_request) {
            api_request.destroy();
            delete this.cache[jsn.context];
        }

    },

    onKeyUp: function(jsn) {
        log('onKeyUp(): ', jsn);

        const api_request = this.cache[jsn.context];

        if(!api_request)
            this.onWillAppear(jsn);
        else
            api_request.sendRequest();

    }

};


function APIRequest(jsonObj) {
    var settings = jsonObj.payload.settings,
        context = jsonObj.context,
        poll_timer = 0,
        key_state = null;

    function startPeriodicPoll() {

        if(poll_timer !== 0) {
            window.clearInterval(poll_timer);
            poll_timer = 0;
        }

        const frequency = settings.poll_status_frequency || 15;

        poll_timer = setInterval(function() {
            sendRequest(do_status_poll = true);
        }, 1000 * frequency);
    }

    function sendRequest(do_status_poll = false) {
        if (!settings.request_url) {
            $SD.api.showAlert(context);
            return;
        }

        if (do_status_poll) {
            if (!Boolean(settings.response_parse) || !Boolean(settings.poll_status)) return;
            if (!settings.poll_status_url) return;
        }

        let url    = do_status_poll ? settings.poll_status_url : settings.request_url;
        let method = (do_status_poll ? settings.poll_status_method : settings.request_method) || 'GET';

        const opts = {
            cache: 'no-cache',
            headers: constructHeaders(),
            method: method,
            body: ['GET', 'HEAD'].includes(method)
                                    ? undefined
                                    : settings.request_body,
        };

        log('sendRequest(): URL:', url, 'ARGS:', opts);

        fetch(url, opts)
            .then((resp) => checkResponseStatus(resp))
            .then((resp) => updateImage(resp, do_status_poll))
            .then((resp) => showSuccess(resp, do_status_poll))
            .catch(err => {
                $SD.api.showAlert(context);
                log(err);
            }
        );

        if (!do_status_poll)
            startPeriodicPoll();
    }

    function constructHeaders() {
        let default_headers = settings.request_content_type
                                ? { 'Content-Type': settings.request_content_type }
                                : {};
        let input_headers = {};

        if (settings.request_headers) {
            settings.request_headers.split(/\n/).forEach(h => {
                if (h.includes(':')) {
                    const [name, value] = h.split(/: *(.*)/).map(s => {
                        return s.trim();
                    });

                    if (name) {
                        input_headers[name] = value;
                    }
                }
            });
        }

        return {
            ...default_headers,
            ...input_headers
        }
    }

    async function checkResponseStatus(resp) {
        if (!resp) {
            throw new Error();
        }
        if (!resp.ok) {
            throw new Error(`${resp.status}: ${resp.statusText}\n${await resp.text()}`);
        }
        return resp;
    }

    async function updateImage(resp, do_status_poll) {
        if (!settings.response_parse || !settings.image_matched || !settings.image_unmatched)
            return;

        let json, body;
        var new_key_state = key_state;

        const prefix = (do_status_poll && settings.poll_status && settings.poll_status_parse) ? 'poll_status' : 'response';
        const field  = Utils.getProp(settings, `${prefix}_parse_field`, undefined);
        const value  = Utils.getProp(settings, `${prefix}_parse_value`, undefined);

        if (field  !== undefined && value !== undefined) {
            json = await resp.json();
            new_key_state = (Utils.getProperty(json, field) == value);
        } else if (field !== undefined) {
            json = await resp.json();
            new_key_state = !(['false', '0', '', 'undefined'].indexOf(String(Utils.getProperty(json, field)).toLowerCase().trim()) + 1);
        } else if (value !== undefined) {
            body = await resp.text();
            new_key_state = body.includes(value);
        }

        if (new_key_state == key_state) return;

        key_state = new_key_state;

        path = key_state
                    ? settings.image_matched
                    : settings.image_unmatched;

        log('updateImage(): FILE:', path, 'JSON:', json, 'BODY:', body);

        Utils.loadImage(path, img => $SD.api.setImage(context, img));

        return resp;
    }

    function showSuccess(resp, do_status_poll) {
        if (!do_status_poll && Boolean(settings.enable_success_indicator))
            $SD.api.showOk(context)
        return resp;
    }

    function updateSettings(new_settings) {
        settings = new_settings;
        startPeriodicPoll();
        sendRequest(do_status_poll = true);
    }

    function destroy() {
        if(poll_timer !== 0) {
            window.clearInterval(poll_timer);
            poll_timer = 0;
        }
    }

    startPeriodicPoll();
    sendRequest(do_status_poll = true);

    return {
        sendRequest: sendRequest,
        updateSettings: updateSettings,
        destroy: destroy
    };
}

function log(...msg) {
    console.log(`[${new Date().toLocaleTimeString('UTC', {hourCycle: 'h23'})}]`, ...msg);
    //$SD.api.logMessage(msg.map(stringify).join(' '));
}

function stringify(input) {
    if (typeof input !== 'object' || input instanceof Error) {
        return input.toString();
    }
    return JSON.stringify(input, null, 2);
}
