var AWS = require('aws-sdk');
var async = require('async');

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
             RecordName: tokens[1]
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
               next(err, route53Tags, data);
           });
         },
         function updateDNS(route53Tags, ec2Response, next) {
           console.log("Updating Route53 DNS");
           var resource_records = ec2Response.Reservations.map(function(reservation) {
               console.log("ec2Response.Reservations.Instances[0]:");
               console.log(reservation.Instances[0]);
               return {
                 Value: reservation.Instances[0].PublicIpAddress
               };
           });
           console.log("Resource records:");
           console.log(resource_records);
           route53.changeResourceRecordSets({
               ChangeBatch: {
                 Changes: [
                     {
                       Action: 'UPSERT',
                         ResourceRecordSet: {
                           Name: route53Tags.RecordName,
                           Type: 'A',
                           TTL: 10,
                           ResourceRecords: resource_records
                         }
                     }
                 ]
               },
               HostedZoneId: route53Tags.HostedZoneId
           }, next);
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
