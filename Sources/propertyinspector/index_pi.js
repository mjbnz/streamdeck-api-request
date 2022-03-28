/* global addDynamicStyles, $SD, Utils */
/* eslint-disable no-extra-boolean-cast */

// change this, if you want interactive elements act on any change, or while they're modified
var onchangeevt = 'oninput'; // 'oninput';

// cache some nodes to improve performance
let sdpiWrapper = document.querySelector('.sdpi-wrapper');

var settings = {};
var $localizedStrings = {};

$SD.on('connected', (jsonObj) => {
    console.log("connected", jsonObj);
    addDynamicStyles($SD.applicationInfo.colors, 'connectElgatoStreamDeckSocket');

    $SD.api.getSettings();

    /** Localization */
    if($localizedStrings && Object.keys($localizedStrings).length > 0) {
        localizeUI();
    }

});

$SD.on('didReceiveSettings', (jsonObj) => {

    console.log("didReceiveSettings", jsonObj);

    if(jsonObj && jsonObj.payload && jsonObj.payload.settings) {

        settings = jsonObj.payload.settings;

        Object.keys(settings).map(e => {
            if (e && e != '') {
                const el = document.querySelector(`#${e}`);
                console.log(`searching for: #${e}`, 'found:', el);
                if (el) {
                    if (el.type === 'textarea') {
                        el.value = settings[e];
                        const maxl = el.getAttribute('maxlength');
                        const labels = document.querySelectorAll(`[for='${el.id}']`);
                        if (labels.length) {
                            for (let x of labels) {
                                x.textContent = maxl ? `${el.value.length}/${maxl}` : `${el.value.length}`;
                            }
                        }
                    } else if (el.type === 'checkbox') {
                        el.checked = settings[e];
                    } else if (el.type === 'file') {
                        document.querySelector(`.sdpi-file-info[for="${el.id}"]`).textContent = trimFileName(settings[e]);
                    } else {
                        el.value = settings[e];
                    }
                }
            }
        });

        showHideSettings();
    }

    revealSdpiWrapper();
});


$SD.on('sendToPropertyInspector', (jsn) => {
    const pl = jsn.payload;
    if (pl.hasOwnProperty('error')) {
        sdpiWrapper.innerHTML = `<div class="sdpi-item">
            <details class="message caution">
            <summary class="${pl.hasOwnProperty('info') ? 'pointer' : ''}">${pl.error}</summary>
                ${pl.hasOwnProperty('info') ? pl.info : ''}
            </details>
        </div>`;
    }
});

// eslint-disable-next-line no-unused-vars
function revealSdpiWrapper () {
    sdpiWrapper && sdpiWrapper.classList.remove('hidden');
}

// our method to pass values to the plugin
function sendValueToPlugin (value, param) {
    //console.log($SD, $SD.readyState, $SD.actionInfo, $SD.uuid, param, value);
    if ($SD.connection && ($SD.connection.readyState === 1)) {
        const json = {
            'action': $SD.actionInfo['action'],
            'event': 'sendToPlugin',
            'context': $SD.uuid,
            'payload': {
                [param]: value
            }
        };
        $SD.connection.send(JSON.stringify(json));
    }
}

document.addEventListener('DOMContentLoaded', function () {
    document.body.classList.add(navigator.userAgent.includes("Mac") ? 'mac' : 'win');
    prepareDOMElements(document);
    $SD.on('localizationLoaded', (language) => {
        localizeUI();
    });
});

/** the beforeunload event is fired, right before the PI will remove all nodes */
window.addEventListener('beforeunload', function (e) {
    e.preventDefault();
    sendValueToPlugin('propertyInspectorWillDisappear', 'property_inspector');
    // Don't set a returnValue to the event, otherwise Chromium with throw an error.  // e.returnValue = '';
});

/** CREATE INTERACTIVE HTML-DOM
 * where elements can be clicked or act on their 'change' event.
 * Messages are then processed using the 'handleSdpiItemClick' method below.
 */
function prepareDOMElements(baseElement) {
    baseElement = baseElement || document;
    Array.from(baseElement.querySelectorAll('.sdpi-item-value')).forEach(
        (el, i) => {
            const elementsToClick = [
                'BUTTON',
                'OL',
                'UL',
                'TABLE',
                'METER',
                'PROGRESS',
                'CANVAS'
            ].includes(el.tagName);
            const evt = elementsToClick ? 'onclick' : onchangeevt || 'onchange';

            /** Look for <input><span> combinations, where we consider the span as label for the input
             *  we don't use `labels` for that, because a range could have 2 labels.
             */
            const inputGroup = el.querySelectorAll('input + span');
            if (inputGroup.length === 2) {
                const offs = inputGroup[0].tagName === 'INPUT' ? 1 : 0;
                inputGroup[offs].textContent = inputGroup[1 - offs].value;
                inputGroup[1 - offs]['oninput'] = function() {
                    inputGroup[offs].textContent = inputGroup[1 - offs].value;
                };
            }
            /** We look for elements which have an 'clickable' attribute
             *  we use these e.g. on an 'inputGroup' (<span><input type="range"><span>) to adjust the value of
             *  the corresponding range-control
             */
            Array.from(el.querySelectorAll('.clickable')).forEach(
                (subel, subi) => {
                    subel['onclick'] = function(e) {
                        handleSdpiItemChange(e.target, subi);
                    };
                }
            );
            /** Just in case the found HTML element already has an input or change - event attached, 
             *  we clone it, and call it in the callback, right before the freshly attached event
             */
            const cloneEvt = el[evt];
            const fn = Utils.debounce(function(e,i) { handleSdpiItemChange(e.target, i);}, 750);
            el[evt] = function(e) {
                if (cloneEvt) cloneEvt();
                fn(e,i);
            };
        }
    );

    /**
     * You could add a 'label' to a textares, e.g. to show the number of charactes already typed
     * or contained in the textarea. This helper updates this label for you.
     */
    baseElement.querySelectorAll('textarea').forEach((e) => {
        const maxl = e.getAttribute('maxlength');
        e.targets = baseElement.querySelectorAll(`[for='${e.id}']`);
        if (e.targets.length) {
            let fn = () => {
                for (let x of e.targets) {
                    x.textContent = maxl ? `${e.value.length}/${maxl}` : `${e.value.length}`;
                }
            };
            fn();
            e.onkeyup = fn;
        }
    });

    baseElement.querySelectorAll('[data-open-url]').forEach(e => {
        const value = e.getAttribute('data-open-url');
        if (value) {
            e.onclick = () => {
                let path;
                if (value.indexOf('http') !== 0) {
                    path = document.location.href.split('/');
                    path.pop();
                    path.push(value.split('/').pop());
                    path = path.join('/');
                } else {
                    path = value;
                }
                $SD.api.openUrl($SD.uuid, path);
            };
        } else {
            console.log(`${value} is not a supported url`);
        }
    });
}

function handleSdpiItemChange(e, idx) {

    /** Following items are containers, so we won't handle clicks on them */
    
    if (['OL', 'UL', 'TABLE'].includes(e.tagName)) {
        return;
    }

    /** SPANS are used inside a control as 'labels'
     * If a SPAN element calls this function, it has a class of 'clickable' set and is thereby handled as
     * clickable label.
     */
    if (e.tagName === 'SPAN') {
        const inp = e.parentNode.querySelector('input');
        var tmpValue;
        
        // if there's no attribute set for the span, try to see, if there's a value in the textContent
        // and use it as value
        if (!e.hasAttribute('value')) {
               tmpValue = Number(e.textContent);
            if (typeof tmpValue === 'number' && tmpValue !== null) {
                e.setAttribute('value', 0+tmpValue); // this is ugly, but setting a value of 0 on a span doesn't do anything
                e.value = tmpValue; 
            }
        } else {
            tmpValue = Number(e.getAttribute('value'));
        }
        
        if (inp && tmpValue !== undefined) {
            inp.value = tmpValue;
        } else return;
    }

    const selectedElements = [];
    const isList = ['LI', 'OL', 'UL', 'DL', 'TD'].includes(e.tagName);
    const sdpiItem = e.closest('.sdpi-item');
    const sdpiItemGroup = e.closest('.sdpi-item-group');
    let sdpiItemChildren = isList
        ? sdpiItem.querySelectorAll(e.tagName === 'LI' ? 'li' : 'td')
        : sdpiItem.querySelectorAll('.sdpi-item-child > input');

    if (isList) {
        const siv = e.closest('.sdpi-item-value');
        if (!siv.classList.contains('multi-select')) {
            for (let x of sdpiItemChildren) x.classList.remove('selected');
        }
        if (!siv.classList.contains('no-select')) {
            e.classList.toggle('selected');
        }
    }
  
    if (sdpiItemChildren.length && ['radio','checkbox'].includes(sdpiItemChildren[0].type)) {
        e.value = e.checked;
    }
    if (sdpiItemGroup && !sdpiItemChildren.length) {
        for (let x of ['input', 'meter', 'progress']) {
            sdpiItemChildren = sdpiItemGroup.querySelectorAll(x);
            if (sdpiItemChildren.length) break;
        }
    }

    if (e.selectedIndex !== undefined) {
        if (e.tagName === 'SELECT') {
            sdpiItemChildren.forEach((ec, i) => {
                selectedElements.push({ [ec.id]: ec.value });
            });
        }
        idx = e.selectedIndex;
    } else {
        sdpiItemChildren.forEach((ec, i) => {
            if (ec.classList.contains('selected')) {
                selectedElements.push(ec.textContent);
            }
            if (ec === e) {
                idx = i;
                selectedElements.push(ec.value);
            }
        });
    }

    const returnValue = {
        key: e.id && e.id.charAt(0) !== '_' ? e.id : sdpiItem.id,
        value: isList
               ? e.textContent
               : e.value === 'true'
                 ? true 
                 : e.value === 'false'
                   ? false
                   : e.value
                     ? e.type === 'file'
                       ? decodeURIComponent(e.value.replace(/^C:\\fakepath\\/, ''))
                       : e.value
                     : e.getAttribute('value'),
        group: sdpiItemGroup ? sdpiItemGroup.id : false,
        index: idx,
        selection: selectedElements,
        checked: e.checked
    };

    /** Just simulate the original file-selector:
     * If there's an element of class '.sdpi-file-info'
     * show the filename there
     */
    if (e.type === 'file') {
        const info = sdpiItem.querySelector('.sdpi-file-info');
        if (info) {
            info.textContent = trimFileName(returnValue.value);
        }
    }

    settings[returnValue.key] = returnValue.value;

    if($SD && $SD.connection) {
        console.log('setSettings(): ', settings);
        $SD.api.setSettings($SD.uuid, settings);
    }

    showHideSettings();
}

function trimFileName(f) {
    const s = f.split('/').pop();
    const l = s.length;
    return (l > 28) ? s.substr(0, 10) + '...' + s.substr(l - 10, l) : s;
}

function autoGrow(el) {
    el.style.height = "auto";
    el.style.height = (el.scrollHeight)+"px";
}

function showHideSettings() {
    var d;
    d = document.getElementById('advanced_settings_container');
    d.style.display = settings.advanced_settings ? "" : "none";

    d = document.getElementById('request_parameters_container');
    d.style.display = settings.request_parameters ? "" : "none";

    d = document.getElementById('response_parse_container');
    d.style.display = settings.response_parse ? "" : "none";

    d = document.getElementById('poll_status_container');
    d.style.display = settings.poll_status ? "" : "none";

    d = document.getElementById('poll_status_parse_container');
    d.style.display = settings.poll_status_parse ? "" : "none";
}

function localize(s) {
    if(Utils.isUndefined(s)) return '';
    let str = String(s);
    try {
        str = $localizedStrings[str] || str;
    } catch(b) {}
    return str;
};

// eslint-disable-next-line no-unused-vars
function localizeUI () {
    const el = document.querySelector('.sdpi-wrapper');
    Array.from(el.querySelectorAll('.sdpi-item-label')).forEach(e => {
        e.innerHTML = e.innerHTML.replace(e.innerText, localize(e.innerText));
        console.log(`sdpi-label Localized ${getDomPath(e)}`, e);
    });
    Array.from(el.querySelectorAll('*:not(script)')).forEach(e => {
        if (e.childNodes && e.childNodes.length > 0 && e.childNodes[0].nodeValue && typeof e.childNodes[0].nodeValue === 'string') {
            e.childNodes[0].nodeValue = localize(e.childNodes[0].nodeValue);
            console.log(`Localized ${getDomPath(e)}`, e);
        }
    });
};

function getDomPath(el) {
    var stack = [];
    while ( el.parentNode != null ) {
      var sibCount = 0;
      var sibIndex = 0;
      for ( var i = 0; i < el.parentNode.childNodes.length; i++ ) {
        var sib = el.parentNode.childNodes[i];
        if ( sib.nodeName == el.nodeName ) {
          if ( sib === el ) {
            sibIndex = sibCount;
          }
          sibCount++;
        }
      }
      if ( el.hasAttribute('id') && el.id != '' ) {
        stack.unshift(el.nodeName.toLowerCase() + '#' + el.id);
      } else if ( sibCount > 1 ) {
        stack.unshift(el.nodeName.toLowerCase() + ':eq(' + sibIndex + ')');
      } else {
        stack.unshift(el.nodeName.toLowerCase());
      }
      el = el.parentNode;
    }
  
    return stack.slice(1).join(' > '); // removes the html element
}
