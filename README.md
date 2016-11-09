# Lambda-AWS-AutoScalingGroups-Route53
AWS Tricks: Updating Route53 DNS for AutoScalingGroup using Lambda

This is the works of John Engelman, which he published on the 'Net on July 7, 2015.

The original is located at https://objectpartners.com/2015/07/07/aws-tricks-updating-route53-dns-for-autoscalinggroup-using-lambda/
and this is just my way of keeping track of the changes of that
blog posting.


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


Each commit will have a "Work by" at the end to indicate who did
what.
