# StreamDeck API Request Plugin

A Plugin for the Elgato Stream Deck for calling arbitrary HTTP API requests,
and optionally changing the Stream Deck key icon based on the response.

Additionally, the plugin can poll a (different, if required) API at a
pre-determined interval in order to update the key icon to reflect external
changes in state.

### Features:
* Specifying HTTP Method, Headers, and Body if applicable
* Parsing of request response to set key icon
* Periodic Polling of status API
* Polling of status on startup, configuration changes, and upon initial display
  (when changing to a streamdeck profile with the plugin visible)

### Response parsing supports:
* Path to a JSON field, and expected matching value
* Path to a boolean JSON field
* Generic search of the response body for an arbitrary string
