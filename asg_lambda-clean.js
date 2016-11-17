'use strict';

var redis = require('redis');

exports.handler = function (event, context) {
    var endpoint = event.EndPoint;
    var group = event.Group;

    console.log("Endpoint: '"+ endpoint + "', Group: '" + group + "'");

    console.log("Connecting to Redis at '" + endpoint + "'");
    var client = new redis.createClient(endpoint, {
        socket_keepalive: false,
        enable_offline_queue: false,
        connect_timeout: 2000,
        retry_strategy: function (options) {
            if (options.error.code === 'ECONNREFUSED')
                return new Error('The server refused the connection');
            if (options.total_retry_time > 1000 * 2)
                return new Error('Retry time exhausted');
            if (options.times_connected > 5)
                return undefined;
            return Math.min(options.attempt * 50, 100);
        }
    });

    client.on("error", function (err) {
        console.error("Error " + err);
        context.done(err);
    });

    client.on('end', () => {
        console.log('Connection closed.');
    });

    client.on('ready', function () {
        console.log("Connected to Redis.");

        console.log("Existing keys:");
        client.keys('*', function (err, keys) {
            if (err) return console.log(err);

            if (keys.length < 1) {
                console.log("No existing keys.");
            } else {
               console.log(JSON.stringify(keys, null, 2));

                keys.map(function(key) {
                    console.log("Trying to delete redis index data for key '" + key + "'");
                    client.del(key, function(err, reply) {
                        if (err || (reply === undefined))
                             console.error("Delete key returned an error: " + reply);
                        else
                             console.log("Deleted key successfully");
                    });
                });
            }
            context.done(err);
        });
    });
};
