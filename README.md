# Supabase on AWS - CloudFormation/CDK Blueprint

_Launch in minutes. Scale to millions._

This repo includes a blueprint of starting Supabase stack on AWS via CloudFormation/CDK. This blueprint use managed services such as Amazon ECS and Amazon Aurora etc...

![architecture-diagram](docs/images/architecture-diagram.png)

## Deploy via CloudFormation template

| Region | View | Stable | Latest |
|:--|:--|:--|:--|
| US East (N. Virginia) | [View](https://supabase-on-aws-us-east-1.s3.amazonaws.com/stable/Supabase.template.json) | [![launch][launch]][stable-us-east-1] | [![launch][launch]][us-east-1] |
| US West (Oregon) | [View](https://supabase-on-aws-us-west-2.s3.amazonaws.com/stable/Supabase.template.json) | [![launch][launch]][stable-us-west-2] | [![launch][launch]][us-west-2] |
| Europe (Ireland) | [View](https://supabase-on-aws-eu-west-1.s3.amazonaws.com/stable/Supabase.template.json) | [![launch][launch]][stable-eu-west-1] | [![launch][launch]][eu-west-1] |
| Asia Pacific (Tokyo) | [View](https://supabase-on-aws-ap-northeast-1.s3.amazonaws.com/stable/Supabase.template.json) | [![launch][launch]][stable-ap-northeast-1] | [![launch][launch]][ap-northeast-1] |
| Asia Pacific (Osaka) | [View](https://supabase-on-aws-ap-northeast-3.s3.amazonaws.com/stable/Supabase.template.json) | [![launch][launch]][stable-ap-northeast-3] | [![launch][launch]][ap-northeast-3] |
| Asia Pacific (Singapore) | [View](https://supabase-on-aws-ap-southeast-1.s3.amazonaws.com/stable/Supabase.template.json) | [![launch][launch]][stable-ap-southeast-1] | [![launch][launch]][ap-southeast-1] |
| Asia Pacific (Sydney) | [View](https://supabase-on-aws-ap-southeast-2.s3.amazonaws.com/stable/Supabase.template.json) | [![launch][launch]][stable-ap-southeast-2] | [![launch][launch]][ap-southeast-2] |

[launch]: https://s3.amazonaws.com/cloudformation-examples/cloudformation-launch-stack.png

[stable-us-east-1]: https://us-east-1.console.aws.amazon.com/cloudformation/home#/stacks/create/review?stackName=Supabase&templateURL=https://supabase-on-aws-us-east-1.s3.amazonaws.com/stable/Supabase.template.json&param_SesRegion=us-east-1
[stable-us-west-2]: https://us-west-2.console.aws.amazon.com/cloudformation/home#/stacks/create/review?stackName=Supabase&templateURL=https://supabase-on-aws-us-west-2.s3.amazonaws.com/stable/Supabase.template.json&param_SesRegion=us-west-2
[stable-eu-west-1]: https://eu-west-1.console.aws.amazon.com/cloudformation/home#/stacks/create/review?stackName=Supabase&templateURL=https://supabase-on-aws-eu-west-1.s3.amazonaws.com/stable/Supabase.template.json&param_SesRegion=eu-west-1
[stable-ap-northeast-1]: https://ap-northeast-1.console.aws.amazon.com/cloudformation/home#/stacks/create/review?stackName=Supabase&templateURL=https://supabase-on-aws-ap-northeast-1.s3.amazonaws.com/stable/Supabase.template.json&param_SesRegion=ap-northeast-1
[stable-ap-northeast-3]: https://ap-northeast-3.console.aws.amazon.com/cloudformation/home#/stacks/create/review?stackName=Supabase&templateURL=https://supabase-on-aws-ap-northeast-3.s3.amazonaws.com/stable/Supabase.template.json&param_SesRegion=ap-northeast-1
[stable-ap-southeast-1]: https://ap-southeast-1.console.aws.amazon.com/cloudformation/home#/stacks/create/review?stackName=Supabase&templateURL=https://supabase-on-aws-ap-southeast-1.s3.amazonaws.com/stable/Supabase.template.json&param_SesRegion=ap-southeast-1
[stable-ap-southeast-2]: https://ap-southeast-2.console.aws.amazon.com/cloudformation/home#/stacks/create/review?stackName=Supabase&templateURL=https://supabase-on-aws-ap-southeast-2.s3.amazonaws.com/stable/Supabase.template.json&param_SesRegion=ap-southeast-2

[us-east-1]: https://us-east-1.console.aws.amazon.com/cloudformation/home#/stacks/create/review?stackName=Supabase&templateURL=https://supabase-on-aws-us-east-1.s3.amazonaws.com/latest/Supabase.template.json&param_SesRegion=us-east-1
[us-west-2]: https://us-west-2.console.aws.amazon.com/cloudformation/home#/stacks/create/review?stackName=Supabase&templateURL=https://supabase-on-aws-us-west-2.s3.amazonaws.com/latest/Supabase.template.json&param_SesRegion=us-west-2
[eu-west-1]: https://eu-west-1.console.aws.amazon.com/cloudformation/home#/stacks/create/review?stackName=Supabase&templateURL=https://supabase-on-aws-eu-west-1.s3.amazonaws.com/latest/Supabase.template.json&param_SesRegion=eu-west-1
[ap-northeast-1]: https://ap-northeast-1.console.aws.amazon.com/cloudformation/home#/stacks/create/review?stackName=Supabase&templateURL=https://supabase-on-aws-ap-northeast-1.s3.amazonaws.com/latest/Supabase.template.json&param_SesRegion=ap-northeast-1
[ap-northeast-3]: https://ap-northeast-3.console.aws.amazon.com/cloudformation/home#/stacks/create/review?stackName=Supabase&templateURL=https://supabase-on-aws-ap-northeast-3.s3.amazonaws.com/latest/Supabase.template.json&param_SesRegion=ap-northeast-1
[ap-southeast-1]: https://ap-southeast-1.console.aws.amazon.com/cloudformation/home#/stacks/create/review?stackName=Supabase&templateURL=https://supabase-on-aws-ap-southeast-1.s3.amazonaws.com/latest/Supabase.template.json&param_SesRegion=ap-southeast-1
[ap-southeast-2]: https://ap-southeast-2.console.aws.amazon.com/cloudformation/home#/stacks/create/review?stackName=Supabase&templateURL=https://supabase-on-aws-ap-southeast-2.s3.amazonaws.com/latest/Supabase.template.json&param_SesRegion=ap-southeast-2

### Specification and Limitation

- API
  - All containers run on ECS Fargate (Graviton2).
    - Only Storage API run on x86 pratform.
  - All components are configured with AutoScaling.
  - GraphQL is supported using [PostGraphile](https://www.graphile.org/postgraphile/), because [pg_graphql](https://github.com/supabase/pg_graphql) is not supported with Amazon RDS/Aurora.
- Database
  - Use [Aurora Serverless v2](https://aws.amazon.com/rds/aurora/serverless/).
  - DB password will be rotated automatically every 30 days.
- Service Discovery
  - Use [Cloud Map](https://aws.amazon.com/cloud-map/) as internal DNS.
    - Each component is discovered as `***.supabase.local`.
- Studio
  - You can use authentication using Cognito UserPool.
    - Need to set certificate ARN.
    - By default, use http without authentication.

#### Fargate Task Size

| Size | vCPU | Memory |
|:--|:--|:--|
| nano | 256 | 512 |
| micro | 256 | 1024 |
| small | 512 | 1024 |
| medium | 1024 | 2048 |
| large | 2048 | 4096 |
| xlarge | 4096 | 8192 |
| 2xlarge | 8192 | 16384 |
| 4xlarge | 16384 | 32768 |

## Deploy via CDK

This cdk project has many resources for CloudFormation. **It is highly recomended to remove these resources for CloudFormation to use it as CDK**.

```bash
git clone https://github.com/mats16/supabase-on-aws.git

cd supabase-on-aws

yarn install

cdk deploy Supabase
```
