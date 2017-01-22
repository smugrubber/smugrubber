#!/usr/bin/env node


const webrtc  = require('wrtc');
const config  = require('./config');
const WebSocket = require('ws');

var RTCPeerConnection     = webrtc.RTCPeerConnection;
var RTCSessionDescription = webrtc.RTCSessionDescription;
var RTCIceCandidate       = webrtc.RTCIceCandidate;


var wss = new WebSocket.Server({ port: config.port });
console.log('smugrubber realtime server started on 127.0.0.1:' + config.port);

var rtc_peer_conn;
 
var data_channel_options = {
    ordered: false, //no guaranteed delivery, unreliable but faster
    maxRetransmitTime: 1000, //milliseconds
};
 
var data_channel;


console.log('initialize_rtc');
var configuration = {
    'iceServers': [{
        'url': 'stun:stun.l.google.com:19302'
    }]
};

rtc_peer_conn = new RTCPeerConnection(configuration, null);
rtc_peer_conn.ondatachannel = receive_data_channel;

data_channel = rtc_peer_conn.createDataChannel('textMessages', data_channel_options);
data_channel.onopen = data_channel_state_changed;

wss.on('connection', function connection(ws) {
    ws.on('message', function incoming(message) {
        console.log('received: ' + message);

        var data = JSON.parse(message);
        if(data.emit == "signal") {
            if(data.type == "SDP") {
                console.log("sdp");

                rtc_peer_conn.setRemoteDescription(new RTCSessionDescription(data.message.sdp), function () {
                    // if we received an offer, we need to answer
                    if (rtc_peer_conn.remoteDescription.type == 'offer') {
                        rtc_peer_conn.createAnswer(function(desc) {
                            rtc_peer_conn.setLocalDescription(desc, function () {
                                ws.send(JSON.stringify({
                                    "emit":"signal",
                                    "type":"SDP",
                                    "message": {
                                        'sdp': rtc_peer_conn.localDescription
                                    }
                                }));
                            }, log_error);
                        }, log_error);
                    }
                }, log_error);
            }

            if(data.type == "ice_candidate") {
                console.log('ice_candidate');

                rtc_peer_conn.addIceCandidate(new RTCIceCandidate(data.message.candidate));
            }
        }
    });
});

function data_channel_state_changed()
{
    if (data_channel.readyState === 'open') {
        data_channel.onmessage = receive_data_channel_message;
    }

    console.log('data_channel_state_changed: ' + data_channel.readyState);
}

function receive_data_channel(event)
{
    console.log('receive_data_channel: ' + event.channel);

    data_channel = event.channel;
    data_channel.onmessage = receive_data_channel_message;
}


function receive_data_channel_message(event)
{
    console.log('receive_data_channel_message: ' + event.data);
    data_channel.send('weeeee');
}

function log_error(e)
{
    console.log(e);
}
