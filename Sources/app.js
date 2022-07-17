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

        if (!settings || !api_request) return;

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

        if (!api_request)
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

    function restartPeriodicPoll() {
        const frequency = settings.poll_status_frequency || settings.poll_status_data_frequency || 15;

        destroy();

        if (settings.advanced_settings && (settings.poll_status || settings.poll_status_data)) {
            sendRequest(do_status_poll = true);

            poll_timer = setInterval(function() {
                sendRequest(do_status_poll = true);
            }, 1000 * frequency);
        }
    }

    function sendRequest(do_status_poll = false) {
        if (!settings.request_url) {
            if (!do_status_poll) $SD.api.showAlert(context);
            return;
        }

        if (do_status_poll) {
            // We check the parent-child relationship between settings to skip early when not needed
            //    (left-side: parsing for background && right-side: parsing for displaying data)
            if (!Boolean(settings.response_parse) && !Boolean(settings.response_data)) return;
            if (!Boolean(settings.poll_status)    && !Boolean(settings.poll_status_data)) return;
            if (!settings.poll_status_url         && !settings.poll_status_data_url) return;
        }

        let url    = settings.request_url;
        let body   = undefined;
        let method = 'GET';
        if (settings.advanced_settings) {
            if (do_status_poll) url = settings.poll_status_url ?? settings.poll_status_data_url;
            if (settings.request_parameters) {
                body        = settings.request_body;
                poll_method = settings.poll_status_method ?? settings.poll_status_data_method;
                method      = (do_status_poll ? poll_method : settings.request_method) ?? method;
            }
        }

        const opts = {
            cache: 'no-cache',
            headers: constructHeaders(),
            method: method,
            body: ['GET', 'HEAD'].includes(method)
                                    ? undefined
                                    : body,
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

    }

    function constructHeaders() {
        if (!settings.advanced_settings || !settings.request_parameters) return {};

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
        /*
         * Making sure we run only in one of the 2 relevant cases:
         *    (1) when asked to parse and match to define the background image
         *    (2) when asked to parse and display the data from the response on the key
         */

        // Common / top-level options
        if (!settings.advanced_settings || (!settings.response_parse && !settings.response_data))
            return;

        // Case 1 missing config detection
        if (settings.response_parse && (!settings.image_matched || !settings.image_unmatched))
            return;

        // Case 2 missing config detection (could be commented if we decide that the background image is optional)
        if (settings.response_data && !settings.background_image)
            return;

        let json, body;
        var new_key_state = key_state;
        const want_data   = (settings.response_data) ? true : false;
        const field_name  = (want_data) ? 'data' : 'parse';

        const prefix = (do_status_poll && settings.poll_status && settings.poll_status_parse) ? 'poll_status' : 'response';
        const field  = Utils.getProp(settings, `${prefix}_${field_name}_field`, undefined);
        const value  = Utils.getProp(settings, `${prefix}_parse_value`, undefined);
        // The value will always be undef in Case 2...

        if (want_data) {
            if (field !== undefined) {
                json = await resp.json();
                new_key_state = Utils.getProperty(json, field);
            } else {
                new_key_state = '?????';
            }
        } else {
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
        }

        if (new_key_state == key_state) return;

        key_state = new_key_state;

        // adapting the background image to the Case we are working for
        if (want_data) {
            path = settings.background_image;
        } else {
            path = key_state
                        ? settings.image_matched
                        : settings.image_unmatched;
        }

        log('updateImage(): FILE:', path, 'JSON:', json, 'BODY:', body);

        Utils.loadImage(path, img => $SD.api.setImage(context, img));

        // Defining the text that must be rendered over the image
        if (want_data) {
            var name = (settings.response_data_name) ? `${settings.response_data_name}\n\n` : '';
            var unit = (settings.response_data_unit) ? ` ${settings.response_data_unit}` : '';
            $SD.api.setTitle(context, `${name}${new_key_state}${unit}`, null);
        }

        return resp;
    }

    function showSuccess(resp, do_status_poll) {
        if (settings.advanced_settings && !do_status_poll && Boolean(settings.enable_success_indicator))
            $SD.api.showOk(context)
        return resp;
    }

    function updateSettings(new_settings) {
        settings = new_settings;
        restartPeriodicPoll();
    }

    function destroy() {
        if (poll_timer !== 0) {
            window.clearInterval(poll_timer);
            poll_timer = 0;
        }
    }

    // Temporary tweak to not break existing user configs after creating 'advanced_settings' boolean
    // If the settings hash has more than one key, and it has a request_url, it's got other settings, so set it to true.
    if (!settings.hasOwnProperty('advanced_settings') && settings.hasOwnProperty('request_url') && (Object.keys(settings).length > 1)) {
        log('enabling advanced settings');
        settings.advanced_settings = true;
        $SD.api.setSettings(context, settings);
    }
    // End temporary tweak

    restartPeriodicPoll();

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
