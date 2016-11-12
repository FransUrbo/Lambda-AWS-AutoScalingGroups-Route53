var AWS = require('aws-sdk');
var async = require('async');

var region = 'us-east-1';

var do_round_robin = true;
var do_individual_entries = false;
var do_reverse_entry = false;
var do_debug = false;

/*
 * Flow:
 * Get tags from ASG
 * Process tags retreived
 * Get all values from the DynamoDB table used for 'locking'
 * Get next available, free number from the DynamoDB values and allocate that as 'in use'
 * Get instances in ASG (if do_round_robin=true)
 * Get ID(s) of the instances retreived
 * Get IP(s) of the instances retreived
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
        return "0000"+s;
    } else if (s.length == 2) {
        return "000"+s;
    } else if (s.length == 3) {
        return "00"+s;
    } else if (s.length == 4) {
        return "0"+s;
    } else {
        return s;
    }
}

function normalizeIP(ip) {
    return ip.split("\.").map(function(s) {
        return normalizeNumber(s);
    });
}

function reverseIP(ip) {
    var parts = ip.split("\.");
    return parts[3] + "." + parts[2] + "." + parts[1] + "." + parts[0] + ".in-addr.arpa.";
}

function isEmpty(str) {
   return (!str || 0 === str.length);
}

function findFirstAvailable(numbers) {
    var allocated = numbers.Items.map(function(item) {
        return parseInt(item.HostNumber.N);
    });
    var map = {};
    for(var k in allocated)
        map[allocated[k]] = true;
    for(var i = 1; i < 100000; i++)
        if(!map[i])
            return i;
}

exports.handler = function (event, context) {
  var asg_msg = JSON.parse(event.Records[0].Sns.Message);
  var asg_name = asg_msg.AutoScalingGroupName;
  var asg_event = asg_msg.Event;

  console.log(asg_event);
  if (asg_event === "autoscaling:EC2_INSTANCE_LAUNCH" || asg_event === "autoscaling:EC2_INSTANCE_TERMINATE") {
    console.log(asg_msg.Description);

    var autoscaling = new AWS.AutoScaling({region: region});
    var ec2 = new AWS.EC2({region: region});
    var route53 = new AWS.Route53();
    if (do_individual_entries)
        var dynamoDB = new AWS.DynamoDB({apiVersion: '2012-08-10'});

    async.waterfall([
         function describeTags(next) {
           console.log("Retrieving ASG Tags");
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
           console.log("Processing ASG Tags");
           console.log(JSON.stringify(response.Tags, null, 2));
           if (response.Tags.length === 0)
             return next("ASG: " + asg_name + " does not define Route53 DomainMeta tag.");
           var tokens = response.Tags[0].Value.split(':');
           instance.route53Tags = {
             HostedZoneId: tokens[0],
             RecordName: tokens[1],
             DomainName: tokens[2]
           };
           next(null, instance);
         },
         function retreiveHostNumbers(instance, next) {
             if (do_individual_entries) {
                 console.log("Route53 tags:");
                 console.log(instance.route53Tags);
                 var table_name = "autoscaling_event_update_route53-" + instance.route53Tags.RecordName;
                 console.log("DynamoDB table name: '" + table_name + "'");
                 var existing = dynamoDB.scan({
                     TableName: table_name
                 }, function(err, data) {
                     if (err) {
                         console.log("Dynamo DB scan() returned an error:");
                         console.log(JSON.stringify(err, null, 2));
                     } else
                         console.log(JSON.stringify(data, null, 2));
                     next(err, instance, data);
                 });
             } else {
                 next(err, instance, null);
             }
         },
         function allocateHostNumber(instance, host_numbers, next) {
             instance.NR = 1;
             if (do_individual_entries) {
                 if (asg_event === "autoscaling:EC2_INSTANCE_LAUNCH") {
                     console.log("Host numbers:");
                     console.log(JSON.stringify(host_numbers, null, 2));
                     if (host_numbers.Count !== 0)
                         instance.NR = findFirstAvailable(host_numbers);
                     var table_name = "autoscaling_event_update_route53-" + instance.route53Tags.RecordName;
                     console.log("Allocating host number '" + instance.NR + "'");
                     dynamoDB.putItem({
                         TableName: table_name,
                         Item: {
                             HostNumber: { N: instance.NR + "" },
                             IPAddress:  { S: "0" }
                         }
                     }, function(err, data) {
                         if (err) {
                             console.log("Dynamo DB putItem() returned an error:");
                             console.log(JSON.stringify(err, null, 2));
                         }
                         next(null, instance);
                     });
                 } else {
                     next(null, instance);
                 }
             } else {
                 next(null, instance);
             }
         },
         function retrieveASGInstances(instance, next) {
           if (do_round_robin) {
             console.log("Retrieving Instances in ASG");
             autoscaling.describeAutoScalingGroups({
                 AutoScalingGroupNames: [asg_name],
                 MaxRecords: 1
             }, function(err, data) {
                 console.log(JSON.stringify(data, null, 2));
                 next(err, instance, data);
             });
           } else {
             next(null, instance, null);
           }
         },
         function retrieveInstanceIds(instance, asgResponse, next) {
           var instance_ids;
           if (do_round_robin) {
             if (asgResponse.AutoScalingGroups[0].Instances.length <= 0)
               next("No instances in ASG!");
             console.log("Retrieving Instance ID(s) in ASG");
             console.log(JSON.stringify(asgResponse.AutoScalingGroups[0].Instances, null, 2));
             instance_ids = asgResponse.AutoScalingGroups[0].Instances.map(function(inst) {
               return inst.InstanceId;
             });
           } else
             instance_ids = [ instance.ID ];
           ec2.describeInstances({
               DryRun: false,
               InstanceIds: instance_ids
           }, function(err, data) {
               next(err, instance, data);
           });
         },
         function extractIpAddresses(instance, ec2Response, next) {
           console.log("Extracting instance(s) IP addresses");
           console.log(JSON.stringify(ec2Response, null, 2));
           var resource_records = ec2Response.Reservations.map(function(reservation) {
               var inst = reservation.Instances[0];
               if (inst.InstanceId == instance.ID)
                   instance.IP = inst.PublicIpAddress ? inst.PublicIpAddress : inst.PrivateIpAddress;
               return inst.PublicIpAddress ? {
                   Value: inst.PublicIpAddress
               } : {
                   Value: inst.PrivateIpAddress
               };
           }).filter(function(ip) {
               return ip.Value !== undefined;
           });
           console.log("Resource records");
           console.log(JSON.stringify(resource_records, null, 2));
           next(null, instance, resource_records);
         },
         function sortIPs(instance, resource_records, next) {
             var records = resource_records.sort(function(a,b) {
                 return normalizeIP(a.Value) > normalizeIP(b.Value);
             });
             next(null, instance, records);
         },
         function deallocateHostNumber(instance, resource_records, next) {
// TODO:
// Go through the 'host_number' list, look for the IP of the relevant host (which is in the 'resource_records' list).
//             if (do_individual_entries && asg_event === "autoscaling:EC2_INSTANCE_TERMINATE") {
//             }
             instance.NR = 1;
             next(null, instance, resource_records);
         },
         function retrieveHostedZones(instance, resource_records, next) {
             console.log("Retrieving hosted zones");
             var hosted_zones = route53.listHostedZones({}, function(err, data) {
                 console.log(JSON.stringify(data, null, 2));
                 next(err, instance, resource_records, data);
             });
         },
         function retrieveZoneIds(instance, resource_records, r53Response, next) {
             console.log("Hosted zones:");
             console.log(JSON.stringify(r53Response.HostedZones, null, 2));
             var zone_ids = r53Response.HostedZones.map(function(zone) {
                 return {
                     Id: zone.Id.split("/")[2],
                     Name: zone.Name
                 };
             });
             next(null, instance, resource_records, zone_ids);
         },
         function retrieveZoneRecords(instance, resource_records, zone_ids, next) {
             console.log("Retrieving zone records for the following zone(s) list");
             console.log(JSON.stringify(zone_ids, null, 2));
             var promises = [];
             for (var i = 0; i < zone_ids.length; i++) {
                 var promise = route53.listResourceRecordSets({
                     HostedZoneId: zone_ids[i].Id
                 }).promise();
                 promises.push(promise);
             }
             Promise.all(promises).then(recs => {
                next(null, instance, resource_records, zone_ids, recs);
             }).catch(reason => {
                console.log(reason);
             });
         },
         function processZoneRecords(instance, resource_records, zone_ids, zone_records, next) {
             console.log("Processing zone records");
             console.log(JSON.stringify(zone_records, null, 2));
             var records = zone_records.map(function(record) {
                 return {
                     Zone: record.ResourceRecordSets[0].Name,
                     Records: record.ResourceRecordSets.filter(function(rs) {
                         return rs.Type == "A" || rs.Type == "PTR";
                     }).map(function(r) {
                         return {
                             Name: r.Name,
                             Type: r.Type,
                             Values: r.ResourceRecords.map(function(rr) {
                                 return rr.Value
                             })
                         }
                     })
                 }
             }).filter(function(r) {
                 return r.Records.length >0;
             });
             console.log("Records:");
             console.log(JSON.stringify(records, null, 2));
// TODO: 'record' is not returned!!
             next(null, instance, resource_records, zone_ids);
         },
         function matchReverseIpsWithReverseIds(instance, resource_records, zone_ids, next) {
             reverse_records = [ reverseIP(instance.IP) ];
             var reverse_map = zone_ids.map(function(zone) {
                 var j = {};
                 j[zone.Id] = reverse_records.filter(function(record) {
                     return record.indexOf("." + zone.Name) > 0;
                 }).map(function(record) {
                     return record;
                 });
                 return j;
             }).filter(function(x) {
                 function first(obj) {
                     for (var a in obj)
                         return a;
                 }
                 return x[first(x)].length > 0;
             });
             next(null, instance, resource_records, reverse_map[0]);
         },
         function updateDNSReverse(instance, resource_records, reverse_map, next) {
             if (do_reverse_entry && do_individual_entries) {
                 console.log("Reverse map");
                 console.log(JSON.stringify(reverse_map, null, 2));
                 var zone_id = Object.keys(reverse_map)[0];
                 var cnt = "-" + normalizeNumber(instance.NR + "");
                 if (instance.route53Tags.DomainName !== undefined)
                     fqdn_record = instance.route53Tags.RecordName + cnt + "." + instance.route53Tags.DomainName;
                 else
                     fqdn_record = instance.route53Tags.RecordName + cnt;
                 var action = "";
                 if (asg_event === "autoscaling:EC2_INSTANCE_LAUNCH")
                     action = 'UPSERT';
                 else
                     action = 'DELETE';
                 zone_change = {
                     HostedZoneId: zone_id,
                     ChangeBatch: {
                         Changes: [{
                             Action: action,
                             ResourceRecordSet: {
                                 Name: reverseIP(instance.IP),
                                 Type: 'PTR',
                                 TTL: 10,
                                 ResourceRecords: [{ Value: fqdn_record }]
                             }
                         }]
                     }
                 };
                 console.log("Updating Route53 Reverse DNS");
                 console.log("Zone change request:");
                 console.log(JSON.stringify(zone_change, null, 2));
                 if (!do_debug)
                     route53.changeResourceRecordSets(zone_change, next);
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
             }
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
                 if (asg_event === "autoscaling:EC2_INSTANCE_LAUNCH")
                     action = 'UPSERT';
                 else
                     action = 'DELETE';
                 zone_change.ChangeBatch.Changes.push({
                     Action: action,
                     ResourceRecordSet: {
                         Name: record,
                         Type: 'A',
                         TTL: 10,
                         ResourceRecords: [ { Value: instance.IP } ]
                     }
                 });
             };
             console.log("Updating Route53 Forward DNS");
             if (do_debug) {
                 console.log("Debug enabled. Zone change request:");
                 console.log(JSON.stringify(zone_change, null, 2));
             } else {
                 console.log("Zone change request:");
                 console.log(JSON.stringify(zone_change, null, 2));
                 route53.changeResourceRecordSets(zone_change, next);
             }
             if (do_individual_entries) {
                 next(null, instance, next);
             }
         },
         function updateHostNumberReservation(instance, next) {
             if (do_individual_entries) {
                 var table_name = "autoscaling_event_update_route53-" + instance.route53Tags.RecordName;
                 if (asg_event === "autoscaling:EC2_INSTANCE_LAUNCH") {
                     console.log("Updating DynamoDB table '" + table_name + "' with IP '" + instance.IP + "' for host number '" + instance.NR + "'");
                     dynamoDB.updateItem({
                         TableName: table_name,
                         Key: {
                             HostNumber: { N: instance.NR + "" }
                         },
                         UpdateExpression: "set IPAddress = :ip",
                         ExpressionAttributeValues: {
                             ":ip": { S: instance.IP }
                         },
                         ReturnValues:"UPDATED_NEW"
                     }, function(err, data) {
                         if (err) {
                             console.log("Dynamo DB updateItem() returned an error:");
                             console.log(JSON.stringify(err, null, 2));
                         }
                     });
                 } else {
                     console.log("Deleting the host number '" + instance.NR + "' from the DynamoDB table '" + table_name + "'");
                     dynamoDB.deleteItem({
                         TableName: table_name,
                         Key: {
                             HostNumber: { N: instance.NR + "" }
                         }
                     }, function(err, data) {
                         if (err) {
                             console.log("Dynamo DB deleteItem() returned an error:");
                             console.log(JSON.stringify(err, null, 2));
                         }
                     });
                 }
                 console.log("End of updateHostNumberReservation()");
             }
         }
    ], function (err) {
         if (err) {
            console.error('Failed to process DNS updates for ASG event: ', err);
         } else {
            console.log("Successfully processed DNS updates for ASG event.");
         }
         context.done(err);
    });
    console.log("End of if(asg_event)");
  } else {
    console.error("Unsupported ASG event: " + asg_name, asg_event);
    context.done("Unsupported ASG event: " + asg_name, asg_event);
  }
};
