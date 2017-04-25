# Lambda-AWS-AutoScalingGroups-Route53
AWS Tricks: Updating Route53 DNS for AutoScalingGroup using Lambda

## References to the original
This is the works of John Engelman, which he published on the 'Net on July 7, 2015.

The original is located at https://objectpartners.com/2015/07/07/aws-tricks-updating-route53-dns-for-autoscalinggroup-using-lambda/
and this is just my way of keeping track of the changes of that
blog posting.

Each commit will have a "Work by" at the end to indicate who did
what.

## The DomainMeta ASG tag
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

## Having individual forward and reverse records created
It is now possible to do unique, individual records created.

That is, instead of just a round-robin entry, we can now have something
like:

    www-00001.domain.tld. A 10.10.1.13
    www-00002.domain.tld. A 10.10.1.47

This is done using a ElastiCache/Redis3.2 table, where we store the
number(s) we're using for the hosts.

This is basically only a _lock_ for making sure that concurrent
running Lambda functions don't try to reuse the same number.

### Use-case for individual records
The use-case for this is when you want/need SSL encryption between
hosts. Such as LDAP replication and authentication - the forward and
reverse must match with the hostname of the machine.

### Enable individual records in the code
To enable the functionality to create unique, individual records
in Route53, edit the top of the file and set:

  var do_individual_entries = true;

The original behaviour to add round-robin entries have been kept
and can be used _in addition to_ creating individual records.

### Enable creation of reverse DNS entries
To enable the creation of individual _reverse_ entries in Route53,
set the variable `do_reverse_entry` to **true**.

## Using ElastiCache/Redis3.2 for external number locking
See `elasticache.tf` for how to create such a table using Terraform.
The other Terraform files are support for doing this - the Lambda
function needs to run in a VPC (so that it can access ElastiCache)
and the ElastiCache is started with one instance in each available
availability zone for redunancy. It is also configured to automatically
propagate one of slaves to primary mode if the primary goes down
(like if Amazon is shutting down the AZ where the primary resides).

The key used in the ElastiCache key/value store is prefixed with:

    RecordName:

See the file iams.tf for more information on the IAM role and it's
policies needed to give this Lambda function only the bare minimum
it needs to do it's job.

### Multi-account support
As of 25 Apr 2017, this function now supports multiple accounts.

This means, that it's now possible to run the Lambda function
in one account and have it read and update Route53 (reverse zones)
and Name tags on hosts in another account.

This is done by the 'local' (as in, the account where the Lambda
funcion is running) account role the Lambda function is running
under (see `lambda.tf` - the `ASGNotify` role defined in `iams.tf`)
assuming a role in the remote account (which then have access to
the relevant resource in the that account).

To do this, the 'local' account needs to have the IAM role and
it's policies from the `iams.tf` file and the remote account
needs the corresponding role and policies from the `iams-remote_account.tf`
file.

In this case, this role is called *ASGNotify* in both accounts
(just to make things slightly less complicated).

But this can be specified at the top of the `asg_lambda.js` file.

In addition to this, the SNS topic will need to provide access
to publish to it. This is done by specifying the remote account
ID(s) in it's policy (see the `sns.tf` file).

## Debugging
If the variable `do_debug` is set to **true**, then the actual
writing to Route53 is disabled. Instead, you get a change request
that _would_ have been sent to Route53 as well as more information
on what's going on in the script.
