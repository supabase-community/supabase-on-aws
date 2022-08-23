# Supabase on AWS

![architecture-diagram](docs/images/architecture-diagram.png)

## Deploy via CloudFormation template

| Region | View | Launch |
|:--|:--|:--|
| US East (N. Virginia) | [View](https://supabase-on-aws-us-east-1.s3.amazonaws.com/latest/Supabase.template.json) | [![launch-stack](https://s3.amazonaws.com/cloudformation-examples/cloudformation-launch-stack.png)][us-east-1] |
| US West (Oregon) | [View](https://supabase-on-aws-us-west-2.s3.amazonaws.com/latest/Supabase.template.json) | [![launch-stack](https://s3.amazonaws.com/cloudformation-examples/cloudformation-launch-stack.png)][us-west-2] |
| Europe (Ireland) | [View](https://supabase-on-aws-eu-west-1.s3.amazonaws.com/latest/Supabase.template.json) | [![launch-stack](https://s3.amazonaws.com/cloudformation-examples/cloudformation-launch-stack.png)][eu-west-1] |
| Asia Pacific (Tokyo) | [View](https://supabase-on-aws-ap-northeast-1.s3.amazonaws.com/latest/Supabase.template.json) | [![launch-stack](https://s3.amazonaws.com/cloudformation-examples/cloudformation-launch-stack.png)][ap-northeast-1] |
| Asia Pacific (Singapore) | [View](https://supabase-on-aws-ap-southeast-1.s3.amazonaws.com/latest/Supabase.template.json) | [![launch-stack](https://s3.amazonaws.com/cloudformation-examples/cloudformation-launch-stack.png)][ap-southeast-1] |
| Asia Pacific (Sydney) | [View](https://supabase-on-aws-ap-southeast-2.s3.amazonaws.com/latest/Supabase.template.json) | [![launch-stack](https://s3.amazonaws.com/cloudformation-examples/cloudformation-launch-stack.png)][ap-southeast-2] |

[us-east-1]: https://us-east-1.console.aws.amazon.com/cloudformation/home#/stacks/create/review?stackName=Supabase&templateURL=https://supabase-on-aws-us-east-1.s3.amazonaws.com/latest/Supabase.template.json&param_SesRegion=us-east-1
[us-west-2]: https://us-west-2.console.aws.amazon.com/cloudformation/home#/stacks/create/review?stackName=Supabase&templateURL=https://supabase-on-aws-us-west-2.s3.amazonaws.com/latest/Supabase.template.json&param_SesRegion=us-west-2
[eu-west-1]: https://eu-west-1.console.aws.amazon.com/cloudformation/home#/stacks/create/review?stackName=Supabase&templateURL=https://supabase-on-aws-eu-west-1.s3.amazonaws.com/latest/Supabase.template.json&param_SesRegion=eu-west-1
[ap-northeast-1]: https://ap-northeast-1.console.aws.amazon.com/cloudformation/home#/stacks/create/review?stackName=Supabase&templateURL=https://supabase-on-aws-ap-northeast-1.s3.amazonaws.com/latest/Supabase.template.json&param_SesRegion=ap-northeast-1
[ap-southeast-1]: https://ap-southeast-1.console.aws.amazon.com/cloudformation/home#/stacks/create/review?stackName=Supabase&templateURL=https://supabase-on-aws-ap-southeast-1.s3.amazonaws.com/latest/Supabase.template.json&param_SesRegion=ap-southeast-1
[ap-southeast-2]: https://ap-southeast-2.console.aws.amazon.com/cloudformation/home#/stacks/create/review?stackName=Supabase&templateURL=https://supabase-on-aws-ap-southeast-2.s3.amazonaws.com/latest/Supabase.template.json&param_SesRegion=ap-southeast-2

## Deploy via CDK

```bash
git clone https://github.com/mats16/supabase-on-aws.git
cd supabase-on-aws

yarn install

cdk deploy Supabase
```
