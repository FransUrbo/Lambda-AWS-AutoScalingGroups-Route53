'use strict';

var _ = require('lodash');
var AWS = require('aws-sdk');
var async = require('async');
var redis = require('redis');

var region = 'eu-west-1';
var redis_endpoint = 'redis://elasticache.domain.tld:6379';

var do_round_robin = true;
var do_individual_entries = true;
var do_reverse_entry = true;
var do_debug = false;

/*
 * If this Lambda function is called from ASG events from another
 * account, it will try to assume this defined role.
 *
 * The role ARN will be constructed as:
 *
 *   "arn:aws:iam:<remote_region>:<remote_account_id>:role/<remote_role>"
 *
 * The `remote_region` and `remote_account_id` will be retrieved from the
 * SNS event message.
 */
var remote_role = 'ASGNotify';

/*
 * Flow:
 * Get tags from ASG
 * Process tags retreived
 * Get instances in ASG (if do_round_robin=true)
 * Get ID(s) of the instances retreived
 * Get IP(s) of the instances retreived
 * Get all values from the DynamoDB table used for 'locking'
 * Get next available, free number from the DynamoDB values and allocate that as 'in use'
 * Sort IP(s) retreived
 * Create reverse IP(s) of the IP(s) retreived
 * Get hosted zone(s) from R53
 * Get ID(s) for zone(s) retreived
 * Get [all] zone A/PTR record(s) of the zone(s) retreived
 + Sort out zone record(s) that matches 'DomainMeta'
 * Figure out which reverse IP(s) belong to which R53 zone
 * Change the reverse DNS zone(s) with the reverse IP(s) retreived
 * Change the forward DNS zone(s) with the instance IP(s) retreived
 */

function normalizeNumber(s) {
    if (s.length == 1) {
        return "0000" + s;
    } else if (s.length == 2) {
        return "000" + s;
    } else if (s.length == 3) {
        return "00" + s;
    } else if (s.length == 4) {
        return "0" + s;
    } else {
        return s;
    }
}

function normalizeIP(ip) {
    return ip.split("\.").map(function (s) {
        return normalizeNumber(s);
    });
}

function reverseIP(ip) {
    var parts = ip.split("\.");
    return parts[3] + "." + parts[2] + "." + parts[1] + "." + parts[0] + ".in-addr.arpa.";
}

function setCurrentInstanceNameAndIp(instance, instances, context) {

    var matchingInstance = _.find(instances, function (inst) {
        return inst.InstanceId === instance.ID;
    });

    if (matchingInstance === undefined) {
        console.log("No instance matching id found for instance: " + instance.ID + ". List of instances:");
        console.log(JSON.stringify(instances, null, 2));
        console.error("Expected to find an entry matching ID in reservation instances; found none.")
    }

    instance.IP = matchingInstance.PrivateIpAddress;
    instance.Name = matchingInstance.Tags.map(function (tag) {
        if (tag.Key === "Name") {
            return tag.Value;
        }
    }).filter(function (value) {
        return value !== undefined;
    });
    console.log("Instance IP address: " + instance.IP + " (name: " + instance.Name + ")");
}

exports.handler = function (event, context) {
    var asg_msg = JSON.parse(event.Records[0].Sns.Message);
    var asg_name = asg_msg.AutoScalingGroupName;
    var asg_event = asg_msg.Event;

    /* Get the account ID of the SNS event topic - the "source" account */
    var src_account = event.Records[0].EventSubscriptionArn.split(':')[4];

    /* Get the account ID of the SNS message sender - the "remote" account */
    var rem_account = asg_msg.AccountId;
    var rem_region = asg_msg.AutoScalingGroupARN.split(':')[3];

    if (do_debug) {
        console.log("Source account ID: '" + src_account + "', Remote account ID: '" + rem_account + "' (Region: '" + rem_region+ " ')");
        console.log("Event details: '" + JSON.stringify(event, null, 2) + "'");
    }

    if (asg_event === "autoscaling:EC2_INSTANCE_LAUNCH" || asg_event === "autoscaling:EC2_INSTANCE_TERMINATE") {
        console.log("ASG message description: '" + asg_msg.Description + "'");

        if (do_individual_entries) {
            var redisClient = new redis.createClient(redis_endpoint, {
                socket_keepalive: false,
                enable_offline_queue: false,
                connect_timeout: 2000,
                retry_strategy: function (options) {
                    if (options.error.code === 'ECONNREFUSED') {
                        return new Error('The server refused the connection');
                    }
                    if (options.total_retry_time > 1000 * 2) {
                        return new Error('Retry time exhausted');

                    }
                    if (options.times_connected > 5) {
                        return undefined;
                    }
                    return Math.min(options.attempt * 50, 100);
                }
            });
            redisClient.on("error", function (err) {
                if (err) {
                    console.error("Radius client error");
                    context.done(err);
                }
            });
            redisClient.on('end', function () {
                console.log('Connection closed.');
            });
        }

        /* These are global variables initiated in authenticate() below */
        var autoscaling, ec2, route53;

        async.waterfall([
            function assumeRemoteRole(next) {
                /* If these don't match, assume the 'XXX' role in the remote account */
                if ((src_account != rem_account) && remote_role) {
                    var sts = new AWS.STS({region: rem_region});

                    var roleSessionName = src_account + "-" + rem_account;
                    var roleArn = "arn:aws:iam::" + rem_account + ":role/" + remote_role;

                    if (do_debug) {
                        console.log("Session name: '" + roleSessionName + "'");
                        console.log("Assuming role '" + roleArn + "'");
                    }

                    sts.assumeRole({
                        DurationSeconds: 1000,
                        ExternalId: "123ABC",
                        RoleSessionName: roleSessionName,
                        RoleArn: roleArn
                    }, function(err, data) {
                        if (err) {
                            console.log("Could not assume role '" + roleArn + "'");
                            console.log(err, err.stack);
                        }
                        next(null, data);
                    });
                } else {
                    next(null, null);
                }
            },
            function extractCredentials(response, next) {
                if ((src_account != rem_account) && remote_role) {
                    if (do_debug) {
                        console.log("Response from assumeRole():");
                        console.log(JSON.stringify(response, null, 2));
                    }
                    var remoteCredentials = {
                        access_key: response.Credentials.AccessKeyId,
                        secret_key: response.Credentials.SecretAccessKey,
                        session_token: response.Credentials.SessionToken
                    };
                    next(null, remoteCredentials);
                } else {
                    next(null, null);
                }
            },
            function authenticate(credentials, next) {
                var request;
                if ((src_account != rem_account) && remote_role) {
                    if (do_debug) {
                        console.log("Credentials to use when connecting to AWS:");
                        console.log(JSON.stringify(credentials, null, 2));
                    }
                    request = {
                        region: region,
                        accessKeyId: credentials.access_key,
                        secretAccessKey: credentials.secret_key,
                        sessionToken: credentials.session_token
                    };
                } else {
                    request = {
                        region: region
                    };
                }

                autoscaling = new AWS.AutoScaling(request);
                ec2 = new AWS.EC2(request);
                route53 = new AWS.Route53(request);

                next();
            },
            function describeTags(next) {
                if (do_debug) {
                    console.log("Retrieving ASG Tags");
                }
                autoscaling.describeTags({
                    Filters: [
                        {
                            Name: "auto-scaling-group",
                            Values: [asg_name]
                        },
                        {
                            Name: "key",
                            Values: ['DomainMeta']
                        }
                    ],
                    MaxRecords: 1
                }, next);
            },
            function processTags(response, next) {
                var instance = {};
                instance.ID = asg_msg.EC2InstanceId;
                if (do_debug) {
                    console.log("Processing ASG Tags");
                    console.log(JSON.stringify(response.Tags, null, 2));
                }
                if (response.Tags.length === 0) {
                    next("ASG: " + asg_name + " does not define Route53 DomainMeta tag.");
                }
                else {
                    var tokens = response.Tags[0].Value.split(':');
                    instance.route53Tags = {
                        HostedZoneId: tokens[0],
                        RecordName: tokens[1],
                        DomainName: tokens[2]
                    };
                    next(null, instance);
                }
            },
            function retrieveASGInstances(instance, next) {
                if (do_debug) {
                    console.log("Route53 tags:");
                    console.log(instance.route53Tags);
                }
                if (do_round_robin) {
                    if (do_debug) {
                        console.log("Retrieving Instances in ASG");
                    }
                    autoscaling.describeAutoScalingGroups({
                        AutoScalingGroupNames: [asg_name],
                        MaxRecords: 1
                    }, function (err, data) {
                        if (err) {
                            console.error("Failed to describe autoscaling group!");
                            console.log(err);
                        }
                        if (do_debug) {
                            console.log(JSON.stringify(data, null, 2));
                        }
                        next(err, instance, data);
                    });
                } else {
                    next(null, instance, null);
                }
            },
            function retrieveInstanceIds(instance, asgResponse, next) {
                if (do_round_robin
                    && asg_event === "autoscaling:EC2_INSTANCE_TERMINATE"
                    && asgResponse.AutoScalingGroups[0].Instances.length <= 0) {
                    next("No instances in ASG!");
                }
                else {
                    var instance_ids;
                    if (do_round_robin) {
                        if (asg_event === "autoscaling:EC2_INSTANCE_TERMINATE") {
                            console.log("Removing the ElastiCache entry for '" + instance.ID + "'");
                            redisClient.eval(['local id = redis.call("HGET", KEYS[1]..":map", KEYS[2]); redis.call("HDEL", KEYS[1]..":map", KEYS[2]); ' +
                                'if (id) then return {id, redis.call("RPUSH", KEYS[1]..":list", id)} else return 0 end;',
                                    2, [instance.route53Tags.RecordName], [instance.ID]],
                                function (err, data) {
                                    if (err) {
                                        console.log("Redis eval()/del returned error!");
                                        console.dir(err);
                                    } else if (do_debug) {
                                        console.log("Redis eval()/del returned data: '" + data + "'");
                                    }

                                    if (data === 0) {
                                        context.done("Found no entry to delete during '" + asg_name, asg_event + "' event.");
                                    }
                                });
// TODO: This will leave the reverse and forward DNS entry dangling!
//       No other way to do it - can't get the IP and therefor can't
//       create a reverse entry for it and can therefor not find the
//       zone the reverse IP belongs to and can therefor not remove
//       the reverse entry.
//       This doesn't matter for the forward entry because it will
//       simply be overwritten. For the reverse, the problem isn't
//       horrible either. Any reverse lookup will be on the IP, so
//       that will reverse to the correct name. The additional reverse
//       entries (for host that no longer exists), the IP(s) for those
//       don't exists either, so it isn't such a big deal that a non
//       existing IP reverse to an existing host.
                        }
                        if (do_debug) {
                            console.log("Retrieving Instance ID(s) in ASG");
                            console.log(JSON.stringify(asgResponse.AutoScalingGroups[0].Instances, null, 2));
                        }
                        instance_ids = asgResponse.AutoScalingGroups[0].Instances.map(function (inst) {
                            return inst.InstanceId;
                        });
                    } else {
                        if (do_debug) {
                            console.log("Using Instance ID from event message:");
                            console.log(instance.ID);
                        }
                        instance_ids = [instance.ID];
                    }
                    ec2.describeInstances({
                        DryRun: false,
                        InstanceIds: instance_ids
                    }, function (err, data) {
                        if (err) {
                            console.error("Failed to describe instances!");
                            console.log(err);
                        }
                        next(err, instance, data);
                    });
                }
            },
            function extractIpAddresses(instance, ec2Response, next) {
                if (do_debug) {
                    console.log("Extracting instance(s) IP addresses");
                    console.log(JSON.stringify(ec2Response, null, 2));
                }

                var instances = _.flatten(
                    _.map(ec2Response.Reservations, function (reservation) {
                        return reservation.Instances;
                    }));

                setCurrentInstanceNameAndIp(instance, instances);
                var resource_records = _.map(instances, function (inst) {
                    return {Value: inst.PrivateIpAddress};
                });
                resource_records = _.filter(resource_records, function (record) {
                    return record.Value !== undefined;
                });

                if (do_debug) {
                    console.log("Instance record:");
                    console.log(JSON.stringify(instance, null, 2));
                    console.log("Resource records:");
                    console.log(JSON.stringify(resource_records, null, 2));
                }
                next(null, instance, resource_records);
            },
            function allocateHostNumber(instance, resource_records, next) {
                instance.NR = 0;
                if (do_individual_entries) {
                    if (asg_event === "autoscaling:EC2_INSTANCE_LAUNCH") {
                        // Find existing mapped host number.
                        redisClient.eval(['local hostId = redis.call("HGET", KEYS[1]..":map", KEYS[2]); if (hostId) then else hostId = 0 end; return hostId;',
                                2, [instance.route53Tags.RecordName], [instance.ID]],
                            function (err, data) {
                                if (err) {
                                    console.log("Redis eval()/checkExisting returned error!");
                                    console.dir(err);
                                } else if (do_debug) {
                                    console.log("Redis eval()/checkExisting returned data: '" + data + "'");
                                }

                                if (data !== 0) {
                                    // If we found a mapped host, we use this existing host number.
                                    next(err, instance, resource_records, data);
                                }
                                else {
                                    // If no existing mapped host number was found, we find any available ones left by previous eval()/del runs,
                                    // or otherwise create a new one.
                                    redisClient.eval(['local top = redis.call("LPOP", KEYS[1]..":list"); if (top) then else top = redis.call("INCR", KEYS[1]..":counter") end; redis.call("HMSET", KEYS[1]..":map", KEYS[2], top); return top;',
                                            2, [instance.route53Tags.RecordName], [instance.ID]],
                                        function (err, data) {
                                            if (err) {
                                                console.log("Redis eval()/add returned error!");
                                                console.dir(err);
                                            } else if (do_debug) {
                                                console.log("Redis eval()/add returned data: '" + data + "'");
                                            }
                                            next(err, instance, resource_records, data);
                                        });
                                }
                            });
                    }
                }
            },
            function sortIPs(instance, resource_records, nr, next) {
                instance.NR = nr;
                console.log("Allocated host number '" + instance.NR + "'");
                var records = resource_records.sort(function (a, b) {
                    return normalizeIP(a.Value) > normalizeIP(b.Value);
                });
                next(null, instance, records);
            },
            function retrieveHostedZones(instance, resource_records, next) {
                if (do_debug) {
                    console.log("Retrieving hosted zones");
                    console.log("Sorted resource records:");
                    console.log(JSON.stringify(resource_records, null, 2));
                    console.log("Instance information:");
                    console.log(JSON.stringify(instance, null, 2));
                }
                var hosted_zones = route53.listHostedZones({}, function (err, data) {
                    if (err) {
                        console.error("Failed to retreive hosted zones!");
                        console.log(err);
                    }
                    if (do_debug) {
                        console.log(JSON.stringify(data, null, 2));
                    }
                    next(err, instance, resource_records, data);
                });
            },
            function retrieveZoneIds(instance, resource_records, r53Response, next) {
                if (do_debug) {
                    console.log("Hosted zones:");
                    console.log(JSON.stringify(r53Response.HostedZones, null, 2));
                }
                var zone_ids = r53Response.HostedZones.map(function (zone) {
                    return {
                        Id: zone.Id.split("/")[2],
                        Name: zone.Name
                    };
                });
                next(null, instance, resource_records, zone_ids);
            },
            function retrieveZoneRecords(instance, resource_records, zone_ids, next) {
                if (do_debug) {
                    console.log("Retrieving zone records for the following zone(s) list:");
                    console.log(JSON.stringify(zone_ids, null, 2));
                }
                var promises = [];
                for (var i = 0; i < zone_ids.length; i++) {
                    var promise = route53.listResourceRecordSets({
                        HostedZoneId: zone_ids[i].Id
                    }).promise();
                    promises.push(promise);
                }
                Promise.all(promises).then(function (recs) {
                    next(null, instance, resource_records, zone_ids, recs);
                }).catch(function (reason) {
                    console.log(reason);
                });
            },
            function processZoneRecords(instance, resource_records, zone_ids, zone_records, next) {
                if (do_debug) {
                    console.log("Processing zone records");
                    console.log(JSON.stringify(zone_records, null, 2));
                }
                var records = zone_records.map(function (record) {
                    return {
                        Zone: record.ResourceRecordSets[0].Name,
                        Records: record.ResourceRecordSets.filter(function (rs) {
                            return rs.Type == "A" || rs.Type == "PTR";
                        }).map(function (r) {
                            return {
                                Name: r.Name,
                                Type: r.Type,
                                Values: r.ResourceRecords.map(function (rr) {
                                    return rr.Value;
                                })
                            };
                        })
                    };
                }).filter(function (r) {
                    return r.Records.length > 0;
                });
                if (do_debug) {
                    console.log("Records:");
                    console.log(JSON.stringify(records, null, 2));
                }
// TODO: 'record' is not returned - what was it for again!!?
                next(null, instance, resource_records, zone_ids);
            },
            function matchReverseIpsWithReverseIds(instance, resource_records, zone_ids, next) {
                if (!instance.IP) {
                    next(1, instance, resource_records, zone_ids);
                }
                else {
                    var reverse_records = [reverseIP(instance.IP)];
                    var reverse_map = zone_ids.map(function (zone) {
                        var j = {};
                        j[zone.Id] = reverse_records.filter(function (record) {
                            return record.indexOf("." + zone.Name) > 0;
                        }).map(function (record) {
                            return record;
                        });
                        return j;
                    }).filter(function (x) {
                        function first(obj) {
                            for (var a in obj)
                                return a;
                        }

                        return x[first(x)].length > 0;
                    });
                    next(null, instance, resource_records, reverse_map[0]);
                }
            },
            function updateDNSReverse(instance, resource_records, reverse_map, next) {
                if (do_reverse_entry && do_individual_entries) {
                    if (do_debug) {
                        console.log("Reverse map:");
                        console.log(JSON.stringify(reverse_map, null, 2));
                    }
                    var zone_id = Object.keys(reverse_map)[0];
                    var cnt = "-" + normalizeNumber(instance.NR + "");
                    var fqdn_record = "";
                    if (instance.route53Tags.DomainName !== undefined)
                        fqdn_record = instance.route53Tags.RecordName + cnt + "." + instance.route53Tags.DomainName;
                    else
                        fqdn_record = instance.route53Tags.RecordName + cnt;
                    var action = "";
// TODO: See retrieveInstanceIds() above.
//       We need to find any records which points to 'fqdn_record' and
//       delete that _in addition_ to adding the new entry.
//                     action = 'DELETE';
                    action = 'UPSERT';
                    var zone_change = {
                        HostedZoneId: zone_id,
                        ChangeBatch: {
                            Changes: [{
                                Action: action,
                                ResourceRecordSet: {
                                    Name: reverseIP(instance.IP),
                                    Type: 'PTR',
                                    TTL: 10,
                                    ResourceRecords: [{Value: fqdn_record}]
                                }
                            }]
                        }
                    };
                    console.log("Updating Route53 Reverse DNS");
                    if (do_debug) {
                        console.log("Zone change request:");
                        console.log(JSON.stringify(zone_change, null, 2));
                    }
                    route53.changeResourceRecordSets(zone_change, function (err, data) {
                        if (err) {
                            console.error("Failed to update zone records (reverse)!");
                            console.log(err);
                        }
                        if (do_debug) {
                            console.log("Running changeResourceRecordSets callback (reverse).");
                            console.log(JSON.stringify(data, null, 2));
                        }
                        next(err, instance, resource_records);
                    });
                }
            },
            function deactivateRemoteRoleForRoute53(instance, resource_records, next) {
                if ((src_account != rem_account) && remote_role) {
                    /* We now revert to using route53 for the current (core) account, as the remote account doesn't
                     have permission to edit the Forward DNS. */
                    route53 = new AWS.Route53({region: region});
                }

                next(null, instance, resource_records);
            },
            function updateDNSForward(instance, resource_records, next) {
                var record = "";
                if (instance.route53Tags.DomainName !== undefined) {
                    record = instance.route53Tags.RecordName + "." + instance.route53Tags.DomainName;
                } else {
                    record = instance.route53Tags.RecordName;
                }
                var zone_change = {
                    HostedZoneId: instance.route53Tags.HostedZoneId,
                    ChangeBatch: {
                        Changes: []
                    }
                };
                if (do_round_robin) {
                    zone_change.ChangeBatch.Changes.push({
                        Action: 'UPSERT',
                        ResourceRecordSet: {
                            Name: record,
                            Type: 'A',
                            TTL: 10,
                            ResourceRecords: resource_records
                        }
                    });
                }
                if (do_individual_entries) {
                    var cnt = "-" + normalizeNumber(instance.NR + "");
                    if (instance.route53Tags.DomainName !== undefined) {
                        record = instance.route53Tags.RecordName + cnt + "." + instance.route53Tags.DomainName;
                    } else {
                        record = instance.route53Tags.RecordName + cnt;
                    }
                    var action = "";
                    action = 'UPSERT';
                    zone_change.ChangeBatch.Changes.push({
                        Action: action,
                        ResourceRecordSet: {
                            Name: record,
                            Type: 'A',
                            TTL: 10,
                            ResourceRecords: [{Value: instance.IP}]
                        }
                    });
                }
                console.log("Updating Route53 Forward DNS");
                if (do_debug) {
                    console.log("Zone change request:");
                    console.log(JSON.stringify(zone_change, null, 2));
                }
                route53.changeResourceRecordSets(zone_change, function (err, data) {
                    if (err) {
                        console.error("Failed to update zone records (forward)!");
                        console.log(err);
                    }
                    if (do_debug) {
                        console.log("Running changeResourceRecordSets callback (forward).");
                        console.log(JSON.stringify(data, null, 2));
                    }
                    next(err, instance);
                });
            },
            function updateNameTag(instance, next) {
                var cnt = "-" + normalizeNumber(instance.NR + "");
                console.log("Updating Name tag to '" + instance.Name + cnt + "'");
                ec2.createTags({
                    Resources: [instance.ID],
                    Tags: [{
                        Key: "Name",
                        Value: instance.Name + cnt
                    }]
                }, function (err, data) {
                    if (err) {
                        console.error("Failed to update instance Name tag!");
                        console.log(err);
                    }
                    if (do_debug) {
                        console.log("Running updateNameTag callback.");
                        console.log(JSON.stringify(data, null, 2));
                    }
                    next(err, instance);
                });
            }
        ], function (err) {
            if (err)
                console.error('Failed to process DNS updates for ASG event: ', err);
            else
                console.log("Successfully processed DNS updates for ASG event.");
            context.done(err);
        });
    } else {
        console.error("Unsupported ASG event: " + asg_name, asg_event);
        context.done("Unsupported ASG event: " + asg_name, asg_event);
    }
};
