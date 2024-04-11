# Supabase on AWS - CloudFormation/CDK Template

_Launch in minutes. Scale to millions._

This repo includes a template of starting Supabase stack on AWS via CloudFormation/CDK. This template use managed services such as Amazon ECS and Amazon Aurora etc...

## Architecture

![architecture-diagram](docs/images/architecture-diagram.png)

![smart-cdn-caching](docs/images/smart-cdn-caching.png)

## Deploy via CloudFormation template

| Region | View | Stable | Latest |
|:--|:--|:--|:--|
| US East (N. Virginia) | [View][us-east-1] | [![launch][launch]][stable-us-east-1] | [![launch][launch]][latest-us-east-1] |
| US West (Oregon) | [View][us-west-2] | [![launch][launch]][stable-us-west-2] | [![launch][launch]][latest-us-west-2] |
| Europe (Ireland) | [View][eu-west-1] | [![launch][launch]][stable-eu-west-1] | [![launch][launch]][latest-eu-west-1] |
| Asia Pacific (Tokyo) | [View][ap-northeast-1] | [![launch][launch]][stable-ap-northeast-1] | [![launch][launch]][latest-ap-northeast-1] |
| Asia Pacific (Osaka) | [View][ap-northeast-3] | [![launch][launch]][stable-ap-northeast-3] | [![launch][launch]][latest-ap-northeast-3] |
| Asia Pacific (Singapore) | [View][ap-southeast-1] | [![launch][launch]][stable-ap-southeast-1] | [![launch][launch]][latest-ap-southeast-1] |
| Asia Pacific (Sydney) | [View][ap-southeast-2] | [![launch][launch]][stable-ap-southeast-2] | [![launch][launch]][latest-ap-southeast-2] |
| Asia Pacific (Mumbai) | [View][ap-south-1] | [![launch][launch]][stable-ap-south-1] | [![launch][launch]][latest-ap-south-1] |

[launch]: https://s3.amazonaws.com/cloudformation-examples/cloudformation-launch-stack.png

[us-east-1]: https://supabase-on-aws-us-east-1.s3.amazonaws.com/stable/Supabase.template.json
[us-west-2]: https://supabase-on-aws-us-west-2.s3.amazonaws.com/stable/Supabase.template.json
[eu-west-1]: https://supabase-on-aws-eu-west-1.s3.amazonaws.com/stable/Supabase.template.json
[ap-northeast-1]: https://supabase-on-aws-ap-northeast-1.s3.amazonaws.com/stable/Supabase.template.json
[ap-northeast-3]: https://supabase-on-aws-ap-northeast-3.s3.amazonaws.com/stable/Supabase.template.json
[ap-southeast-1]: https://supabase-on-aws-ap-southeast-1.s3.amazonaws.com/stable/Supabase.template.json
[ap-southeast-2]: https://supabase-on-aws-ap-southeast-2.s3.amazonaws.com/stable/Supabase.template.json
[ap-south-1]: https://supabase-on-aws-ap-south-1.s3.amazonaws.com/stable/Supabase.template.json

[stable-us-east-1]: https://us-east-1.console.aws.amazon.com/cloudformation/home#/stacks/create/review?stackName=Supabase&templateURL=https://supabase-on-aws-us-east-1.s3.amazonaws.com/stable/Supabase.template.json&param_SesRegion=us-east-1
[stable-us-west-2]: https://us-west-2.console.aws.amazon.com/cloudformation/home#/stacks/create/review?stackName=Supabase&templateURL=https://supabase-on-aws-us-west-2.s3.amazonaws.com/stable/Supabase.template.json&param_SesRegion=us-west-2
[stable-eu-west-1]: https://eu-west-1.console.aws.amazon.com/cloudformation/home#/stacks/create/review?stackName=Supabase&templateURL=https://supabase-on-aws-eu-west-1.s3.amazonaws.com/stable/Supabase.template.json&param_SesRegion=eu-west-1
[stable-ap-northeast-1]: https://ap-northeast-1.console.aws.amazon.com/cloudformation/home#/stacks/create/review?stackName=Supabase&templateURL=https://supabase-on-aws-ap-northeast-1.s3.amazonaws.com/stable/Supabase.template.json&param_SesRegion=ap-northeast-1
[stable-ap-northeast-3]: https://ap-northeast-3.console.aws.amazon.com/cloudformation/home#/stacks/create/review?stackName=Supabase&templateURL=https://supabase-on-aws-ap-northeast-3.s3.amazonaws.com/stable/Supabase.template.json&param_SesRegion=ap-northeast-3
[stable-ap-southeast-1]: https://ap-southeast-1.console.aws.amazon.com/cloudformation/home#/stacks/create/review?stackName=Supabase&templateURL=https://supabase-on-aws-ap-southeast-1.s3.amazonaws.com/stable/Supabase.template.json&param_SesRegion=ap-southeast-1
[stable-ap-southeast-2]: https://ap-southeast-2.console.aws.amazon.com/cloudformation/home#/stacks/create/review?stackName=Supabase&templateURL=https://supabase-on-aws-ap-southeast-2.s3.amazonaws.com/stable/Supabase.template.json&param_SesRegion=ap-southeast-2
[stable-ap-south-1]: https://ap-south-1.console.aws.amazon.com/cloudformation/home#/stacks/create/review?stackName=Supabase&templateURL=https://supabase-on-aws-ap-south-1.s3.amazonaws.com/stable/Supabase.template.json&param_SesRegion=ap-south-1

[latest-us-east-1]: https://us-east-1.console.aws.amazon.com/cloudformation/home#/stacks/create/review?stackName=Supabase&templateURL=https://supabase-on-aws-us-east-1.s3.amazonaws.com/latest/Supabase.template.json&param_SesRegion=us-east-1
[latest-us-west-2]: https://us-west-2.console.aws.amazon.com/cloudformation/home#/stacks/create/review?stackName=Supabase&templateURL=https://supabase-on-aws-us-west-2.s3.amazonaws.com/latest/Supabase.template.json&param_SesRegion=us-west-2
[latest-eu-west-1]: https://eu-west-1.console.aws.amazon.com/cloudformation/home#/stacks/create/review?stackName=Supabase&templateURL=https://supabase-on-aws-eu-west-1.s3.amazonaws.com/latest/Supabase.template.json&param_SesRegion=eu-west-1
[latest-ap-northeast-1]: https://ap-northeast-1.console.aws.amazon.com/cloudformation/home#/stacks/create/review?stackName=Supabase&templateURL=https://supabase-on-aws-ap-northeast-1.s3.amazonaws.com/latest/Supabase.template.json&param_SesRegion=ap-northeast-1
[latest-ap-northeast-3]: https://ap-northeast-3.console.aws.amazon.com/cloudformation/home#/stacks/create/review?stackName=Supabase&templateURL=https://supabase-on-aws-ap-northeast-3.s3.amazonaws.com/latest/Supabase.template.json&param_SesRegion=ap-northeast-3
[latest-ap-southeast-1]: https://ap-southeast-1.console.aws.amazon.com/cloudformation/home#/stacks/create/review?stackName=Supabase&templateURL=https://supabase-on-aws-ap-southeast-1.s3.amazonaws.com/latest/Supabase.template.json&param_SesRegion=ap-southeast-1
[latest-ap-southeast-2]: https://ap-southeast-2.console.aws.amazon.com/cloudformation/home#/stacks/create/review?stackName=Supabase&templateURL=https://supabase-on-aws-ap-southeast-2.s3.amazonaws.com/latest/Supabase.template.json&param_SesRegion=ap-southeast-2
[latest-ap-south-1]: https://ap-south-1.console.aws.amazon.com/cloudformation/home#/stacks/create/review?stackName=Supabase&templateURL=https://supabase-on-aws-ap-south-1.s3.amazonaws.com/latest/Supabase.template.json&param_SesRegion=ap-south-1

### Optional templates

| Template | Link |
|:--|:--|
| AWS WAF (Web ACL) | [![launch][launch]][waf-latest] |

[waf-latest]: https://us-east-1.console.aws.amazon.com/cloudformation/home#/stacks/create/review?stackName=SupabaseWaf&templateURL=https://supabase-on-aws-us-east-1.s3.amazonaws.com/latest/SupabaseWaf.template.json

### Specification and Limitation

- APIs
  - All containers run on ECS Fargate (Graviton2).
  - All components are configured with AutoScaling.
  - GraphQL is not supported, because [pg_graphql](https://github.com/supabase/pg_graphql) is not supported with Amazon RDS/Aurora.
- Service Discovery
  - Each component is discovered as `***.supabase.internal`.
- Database (PostgreSQL)
  - [Amazon Aurora Serverless v2](https://aws.amazon.com/rds/aurora/serverless/) is used.
  - Todo: Add automatically password rotation.
- Supabase Studio
  - It is deployed on [Amplify Hosting](https://aws.amazon.com/amplify/hosting/).
  - Todo: Add option to deploy the studio in different regions.
  - ⚠️ Warning: Supabase Studio is **open to web** and can be accessed by malicious actors. We **strongly** suggest you active ['Access control'](https://docs.aws.amazon.com/amplify/latest/userguide/access-control.html) globaly and setup a strong password and username.

#### Fargate Task Size

| Size | vCPU | Memory |
|:--|:--|:--|
| micro | 256 | 512 |
| small | 512 | 1024 |
| medium | 1024 | 2048 |
| large | 2048 | 4096 |
| xlarge | 4096 | 8192 |
| 2xlarge | 8192 | 16384 |
| 4xlarge | 16384 | 32768 |

#### IAM Policy to create CloudFormation Stack

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "CloudFormation",
            "Effect": "Allow",
            "Action": "cloudformation:*",
            "Resource": "*"
        },
        {
            "Sid": "supabase",
            "Effect": "Allow",
            "Action": [
                "application-autoscaling:*",
                "ec2:*",
                "ecs:*",
                "elasticloadbalancing:*",
                "events:*",
                "iam:*",
                "lambda:*",
                "logs:*",
                "s3:*",
                "secretsmanager:*",
                "servicediscovery:*",
                "ses:*",
                "ssm:*",
                "states:*",
                "rds:*",
                "route53:*"
            ],
            "Resource": "*"
        },
        {
            "Sid": "supabaseCDN",
            "Effect": "Allow",
            "Action": [
                "cloudfront:*",
                "wafv2:Get*",
                "wafv2:List*"
            ],
            "Resource": "*"
        },
        {
            "Sid": "cacheManager",
            "Effect": "Allow",
            "Action": [
                "apigateway:*",
                "lambda:*",
                "logs:*",
                "sqs:*"
            ],
            "Resource": "*"
        },
        {
            "Sid": "supabaseStudio",
            "Effect": "Allow",
            "Action": [
                "amplify:*",
                "codecommit:*",
                "lambda:*",
                "logs:*",
                "sns:*"
            ],
            "Resource": "*"
        }
    ]
}
```

## Deploy via CDK

This cdk project has many resources for CloudFormation. **It is highly recomended to remove these resources for CloudFormation to use it as CDK**.

```bash
git clone https://github.com/mats16/supabase-on-aws.git

cd supabase-on-aws

yarn install

cdk deploy Supabase
```
