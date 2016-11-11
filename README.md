# Lambda-AWS-AutoScalingGroups-Route53
AWS Tricks: Updating Route53 DNS for AutoScalingGroup using Lambda

* References to the original
This is the works of John Engelman, which he published on the 'Net on July 7, 2015.

The original is located at https://objectpartners.com/2015/07/07/aws-tricks-updating-route53-dns-for-autoscalinggroup-using-lambda/
and this is just my way of keeping track of the changes of that
blog posting.

Each commit will have a "Work by" at the end to indicate who did
what.

* The DomainMeta ASG tag
One of my own changes required a change to the 'DomainMeta' tag.
Without the domain name in the request, I got:

  RRSet with DNS name blabla. is not permitted in zone domain.tld.

Adding the domain name ('domain.tld') as a third parameter in
DomainMeta solved this.

So the format of this is now:

  HostedZoneId:RecordName:DomainName

For example:

  ZFBW5S4JKK3LA:www:example.com

The reason I choose to do it that way, instead of the original
way, is because I'm working against having ONE record per IP/instance.

As in, this is now a round-robin entry -> one 'blabla' entry, with
multiple IP addresses.

I'm hoping to do something like

  ZFBW5S4JKK3LA:www-%index%:example.com

and have one 'www-1' for IP1, a 'www-2' for IP2 etc etc..

I'm not sure if this is possible, but the third option is optional,
so the original format of this still works.

* Having individual forward and reverse records created
It is now possible to do unique, individual records created.

This is done using a DynamoDB table, where we store the number(s)
of allocated numbers.

This is basically only a _lock_ for making sure that concurrent
running Lambda functions don't try to reuse the same number.

NOTE: This needs to be tripple checked. I need to verify that the
      reading/writing to the DB is atomic.

See `dynamodb.tf` for how to create such a table using Terraform.

The table name prefix is `autoscaling_event_update_route53-` and
the next part must match (**exactly**) the second part of the
`DomainMeta` key.

The `-%index%` part above turned out to be not needed. Instead,
the _next available number_ taken from the information of the
DynamoDB table is suffixed to the `RecordName` entry in the
`DomainMeta` ASG key.

So in the original example at the very top, the `DomainMeta` key
looked like this:

  ZFBW5S4JKK3LA:www:example.com

That means that the DynamoDB table must be named:

  autoscaling_event_update_route53-www

A new policy was created (and added to the IAM role `ASGNotify`)
with the name `ASGNotifyPolicy_WRITE_DYNAMODB`.

See the file iams.tf for more information on the IAM role and it's
policies.

NOTE: This require one DynamoDB per ASG!

NOTE: The template for the host name is

    RecordName-XXXXX

So the first entry in our example will be

    www-00001

* Enable individual records in the code
To enable the functionality to create unique, individual records
in Route53, edit the top of the file and set:

  var do_individual_entries = true;

The original behaviour to add round-robin entries have been kept
and can be used _in addition to_ creating individual records.

* Debugging
If the variable `do_debug` is set to **true**, then the actual
writing to Route53 is disabled. Instead, you get a change request
that _would_ have been sent to Route53.

* Enable creation of reverse DNS entries
To enable the creation of individual reverse entries in Route53,
set the variable `do_reverse_entry` to **true**.
