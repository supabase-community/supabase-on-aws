# Supabase on AWS

## Deploy via CloudFormation template

| Region | View | Launch |
|:--|:--|:--|
| US East (N. Virginia) | [View](https://supabase-on-aws-us-east-1.s3.amazonaws.com/latest/Supabase.template.json) | [![launch-stack](https://s3.amazonaws.com/cloudformation-examples/cloudformation-launch-stack.png)][us-east-1] |
| US West (Oregon) | [View](https://supabase-on-aws-us-west-2.s3.amazonaws.com/latest/Supabase.template.json) | [![launch-stack](https://s3.amazonaws.com/cloudformation-examples/cloudformation-launch-stack.png)][us-west-2] |
| Europe (Ireland) | [View](https://supabase-on-aws-eu-west-1.s3.amazonaws.com/latest/Supabase.template.json) | [![launch-stack](https://s3.amazonaws.com/cloudformation-examples/cloudformation-launch-stack.png)][eu-west-1] |
| Asia Pacific (Tokyo) | [View](https://supabase-on-aws-ap-northeast-1.s3.amazonaws.com/latest/Supabase.template.json) | [![launch-stack](https://s3.amazonaws.com/cloudformation-examples/cloudformation-launch-stack.png)][ap-northeast-1] |

[us-east-1]: https://us-east-1.console.aws.amazon.com/cloudformation/home#/stacks/new?stackName=Supabase&param_SesRegion=us-east-1&templateURL=https://supabase-on-aws-us-east-1.s3.amazonaws.com/latest/Supabase.template.json
[us-west-2]: https://us-west-2.console.aws.amazon.com/cloudformation/home#/stacks/new?stackName=Supabase&param_SesRegion=us-west-2&templateURL=https://supabase-on-aws-us-west-2.s3.amazonaws.com/latest/Supabase.template.json
[eu-west-1]: https://eu-west-1.console.aws.amazon.com/cloudformation/home#/stacks/new?stackName=Supabase&param_SesRegion=eu-west-1&templateURL=https://supabase-on-aws-eu-west-1.s3.amazonaws.com/latest/Supabase.template.json
[ap-northeast-1]: https://ap-northeast-1.console.aws.amazon.com/cloudformation/home#/stacks/new?stackName=Supabase&param_SesRegion=ap-northeast-1&templateURL=https://supabase-on-aws-ap-northeast-1.s3.amazonaws.com/latest/Supabase.template.json

## How to build and deploy

```bash
yarn install

npx projen

npx projen deploy
```
