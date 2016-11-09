var AWS = require('aws-sdk');
var async = require('async');

function normalizeIP(ip) {
    return ip.split("\.").map(function(s) {
        if (s.length == 1) {
            return "00"+s;
        } else if (s.length == 2) {
            return "0"+s;
        } else {
            return s;
        }
    });
}

function reverseIP(ip) {
    var parts = ip.split("\.");
    return parts[3] + "." + parts[2] + "." + parts[1] + "." + parts[0] + ".in-addr.arpa.";
}

exports.handler = function (event, context) {
  var asg_msg = JSON.parse(event.Records[0].Sns.Message);
  var asg_name = asg_msg.AutoScalingGroupName;
  var instance_id = asg_msg.EC2InstanceId;
  var asg_event = asg_msg.Event;

  console.log(asg_event);
  if (asg_event === "autoscaling:EC2_INSTANCE_LAUNCH" || asg_event === "autoscaling:EC2_INSTANCE_TERMINATE") {
    console.log("Handling Launch/Terminate Event for " + asg_name);

    var autoscaling = new AWS.AutoScaling({region: 'us-east-1'});
    var ec2 = new AWS.EC2({region: 'us-east-1'});
    var route53 = new AWS.Route53();

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
           console.log("Processing ASG Tags");
           console.log(response.Tags);
           if (response.Tags.length === 0) {
             return next("ASG: " + asg_name + " does not define Route53 DomainMeta tag.");
           }
           var tokens = response.Tags[0].Value.split(':');
           var route53Tags = {
             HostedZoneId: tokens[0],
             RecordName: tokens[1],
             DomainName: tokens[2]
           };
           console.log(route53Tags);
           next(null, route53Tags);
         },
         function retrieveASGInstances(route53Tags, next) {
           console.log("Retrieving Instances in ASG");
           autoscaling.describeAutoScalingGroups({
               AutoScalingGroupNames: [asg_name],
               MaxRecords: 1
           }, function(err, data) {
               console.log(data);
               next(err, route53Tags, data);
           });
         },
         function retrieveInstanceIds(route53Tags, asgResponse, next) {
           console.log("Retrieving Instance IDs in ASG");
           console.log(asgResponse.AutoScalingGroups[0]);
           var instance_ids = asgResponse.AutoScalingGroups[0].Instances.map(function(instance) {
               return instance.InstanceId;
           });
           ec2.describeInstances({
               DryRun: false,
               InstanceIds: instance_ids
           }, function(err, data) {
               console.log(data);
               next(err, route53Tags, data);
           });
         },
         function setupIpAddresses(route53Tags, ec2Response, next) {
           var resource_records = ec2Response.Reservations.map(function(reservation) {
               var instance = reservation.Instances[0];
               return instance.PublicIpAddress ? {
                   Value: instance.PublicIpAddress
               } : {
                   Value: instance.PrivateIpAddress
               };
           }).filter(function(ip) {
               return ip.Value !== undefined;
           });
           next(null, route53Tags, resource_records);
         },
         function normalizeIPs(route53Tags, resource_records, next) {
             var records = resource_records.sort(function(a,b) {
                 return normalizeIP(a.Value) > normalizeIP(b.Value);
             });
             next(null, route53Tags, records);
         },
         function reverseIPs(route53Tags, resource_records, next) {
             var reverse = resource_records.map(function(a) {
                 return reverseIP(a.Value);
             });
             next(null, route53Tags, resource_records, reverse);
         },
         function retrieveHostedZones(route53Tags, resource_records, reverse_records, next) {
             var hosted_zones = route53.listHostedZones({
             }, function(err, data) {
                 next(err, route53Tags, resource_records, reverse_records, data);
             });
         },
         function retrieveZoneIds(route53Tags, resource_records, reverse_records, r53Response, next) {
             console.log("Reverse records:");
             console.log(reverse_records);
             console.log("Hosted zones:");
             console.log(r53Response.HostedZones);
             var zone_ids = r53Response.HostedZones.map(function(zone) {
                 return {
                     Id: zone.Id.split("/")[2],
                     Name: zone.Name
                 };
             });
             console.log("Zone IDs:");
             console.log(zone_ids);
             next(null, route53Tags, resource_records, reverse_records, zone_ids);
         },
         function matchReverseIpsWithReverseIds(route53Tags, resource_records, reverse_records, zone_ids, next) {
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
             next(null, route53Tags, resource_records, reverse_map[0]);
         },
         function setupDNSReverseChanges(route53Tags, resource_records, reverse_map, next) {
             console.log("Reverse Map:");
             console.log(reverse_map);
             for (var i = 0; i < Object.length; i++) {
                 var zone_id = Object.keys(reverse_map)[i];
                 var records = reverse_map[zone_id];
                 var zone_change = {
                     HostedZoneId: zone_id,
                     ChangeBatch: {
                         Changes: []
                     }
                 };
                 for (var j = 0; j < records.length; j++) {
                     var fqdn_record = "";
                     if (route53Tags.DomainName !== undefined) {
                         fqdn_record = route53Tags.RecordName + "-" + j + "." + route53Tags.DomainName;
                     } else {
                         fqdn_record = route53Tags.RecordName + "-" + j;
                     }
                     zone_change.ChangeBatch.Changes.push({
                         Action: 'UPSERT',
                         ResourceRecordSet: {
                             Name: records[j],
                             Type: 'PTR',
                             TTL: 10,
                             ResourceRecords: [ { Value: fqdn_record } ]
                         }
                     });
                 }
                 console.log("Updating Route53 Reverse DNS change request (fqdn_record)");
                 console.log(zone_change);
                 route53.changeResourceRecordSets(zone_change, next);
             }
             next(null, route53Tags, resource_records);
         },
         function updateDNSForward(route53Tags, resource_records, next) {
             var record = "";
             if (route53Tags.DomainName !== undefined) {
                 record = route53Tags.RecordName + "." + route53Tags.DomainName;
             } else {
                 record = route53Tags.RecordName;
             }
             var zone_change = {
                 HostedZoneId: route53Tags.HostedZoneId,
                 ChangeBatch: {
                     Changes: []
                 }
             }
             zone_change.ChangeBatch.Changes.push({
                 Action: 'UPSERT',
                 ResourceRecordSet: {
                     Name: record,
                     Type: 'A',
                     TTL: 10,
                     ResourceRecords: resource_records
                 }
             });
             for (var i = 0; i < resource_records.length; i++) {
                 if (route53Tags.DomainName !== undefined) {
                     record = route53Tags.RecordName + "-" + i + "." + route53Tags.DomainName;
                 } else {
                     record = route53Tags.RecordName + "-" + i;
                 }
                 zone_change.ChangeBatch.Changes.push({
                     Action: 'UPSERT',
                     ResourceRecordSet: {
                         Name: record,
                         Type: 'A',
                         TTL: 10,
                         ResourceRecords: [ resource_records[i] ]
                     }
                 });
             };
             console.log("Updating Route53 Forward DNS change request");
             console.log(zone_change);
             route53.changeResourceRecordSets(zone_change, next);
         }
    ], function (err) {
         if (err) {
            console.error('Failed to process DNS updates for ASG event: ', err);
         } else {
            console.log("Successfully processed DNS updates for ASG event.");
         }
         context.done(err);
    });
  } else {
    console.log("Unsupported ASG event: " + asg_name, asg_event);
    context.done("Unsupported ASG event: " + asg_name, asg_event);
  }
};
