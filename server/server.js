#!/usr/bin/env node


const config    = require('./config');
const webrtc    = require('wrtc');
const WebSocket = require('ws');

var RTCPeerConnection     = webrtc.RTCPeerConnection;
var RTCSessionDescription = webrtc.RTCSessionDescription;
var RTCIceCandidate       = webrtc.RTCIceCandidate;

var server = {
    // these maps are referenced by ws
    // which allows them to have unique identifier
    rtc_peer_conns: {},
    data_channels:  {},

    wss: null,

    parse_client_message: function(ws, msg)
    {
       server.data_channels[ws].send('weeeee');
    },

    send_data: function(ws, data)
    {
       server.data_channels[ws].send(JSON.stringify(data));
    },

    // convenience function for ws
    log_error: function(e)
    {
        console.log(e);
    },

    init: function() {
        server.wss = new WebSocket.Server({ port: config.port }),
        console.log('smugrubber realtime server started on 127.0.0.1:' + config.port);


        // listen for websocket connections
        // we use this to be able to create a rtc connection
        server.wss.on('connection', function connection(ws) {
            function receive_data_channel_message(ws, evt)
            {
                if(config.verbose) {
                    console.log('receive_data_channel_message: ' + evt.data);
                }

                server.parse_client_message(ws, evt.data);
            }


            // SETUP NEW CONNECTION AND NEW DATA CHANNEL
            server.rtc_peer_conns[ws] = new RTCPeerConnection(config.rtc_peer_connection_options, null);

            server.rtc_peer_conns[ws].ondatachannel = function(evt) {
                if(config.verbose) {
                    console.log('receive_data_channel');
                }

                server.data_channels[ws] = evt.channel;
                server.data_channels[ws].onmessage = function(evt) {
                    receive_data_channel_message(ws, evt);
                };
            };

            server.data_channels[ws] = server.rtc_peer_conns[ws].createDataChannel('textMessages', config.data_channel_options);
            server.data_channels[ws].onopen = function() {
                if(config.verbose) {
                    console.log('data_channel_state_changed: ' + this.readyState);
                }

                if(this.readyState === 'open') {
                    this.onmessage = function(evt) {
                        receive_data_channel_message(ws, evt);
                    }
                }
            };


            // LISTEN FOR SIGNAL CONNECT NEGOTIATION
            ws.on('message', function incoming(message) {
                if(config.verbose) {
                    console.log('received: ' + message);
                }

                var data = JSON.parse(message);
                if(data.emit == "signal") {
                    if(data.type == "SDP") {
                        server.rtc_peer_conns[ws].setRemoteDescription(new RTCSessionDescription(data.message.sdp), function () {
                            // if we received an offer, we need to answer
                            if(server.rtc_peer_conns[ws].remoteDescription.type == 'offer') {
                                server.rtc_peer_conns[ws].createAnswer(function(desc) {
                                    server.rtc_peer_conns[ws].setLocalDescription(desc, function () {
                                        ws.send(JSON.stringify({
                                            "emit":"signal",
                                            "type":"SDP",
                                            "message": {
                                                'sdp': server.rtc_peer_conns[ws].localDescription
                                            }
                                        }));
                                    }, server.log_error);
                                }, server.log_error);
                            }
                        }, server.log_error);
                    }

                    if(data.type == "ice_candidate") {
                        server.rtc_peer_conns[ws].addIceCandidate(new RTCIceCandidate(data.message.candidate));
                    }
                }
            });
        });
    },
};

server.init();

