# Supabase on AWS — CDK

_Deploy a complete, self-hosted Supabase backend on AWS using CDK._

This project deploys the latest Supabase services on **ECS Fargate (Graviton2)** into your existing VPC and Aurora PostgreSQL database. It matches the official [Supabase Docker Compose](https://github.com/supabase/supabase/tree/master/docker) stack, adapted for AWS managed services.

## Services

| Service | Image | Port |
|---------|-------|------|
| Kong (API Gateway) | `kong/kong:3.9.1` | 8000 |
| Auth (GoTrue) | `supabase/gotrue:v2.186.0` | 9999 |
| PostgREST | `postgrest/postgrest:v14.6` | 3000 |
| Realtime | `supabase/realtime:v2.76.5` | 4000 |
| Storage | `supabase/storage-api:v1.44.2` | 5000 |
| Imgproxy | `darthsim/imgproxy:v3.30.1` | 5001 |
| postgres-meta | `supabase/postgres-meta:v0.95.2` | 8080 |
| Studio | `supabase/studio:2026.03.16-sha-5528817` | 3000 |
| Edge Functions | `supabase/edge-runtime:v1.71.2` | 9000 |
| Supavisor (Pooler) | `supabase/supavisor:2.7.4` | 4000 |

## Architecture

- **Compute**: All 10 services run on ECS Fargate (ARM64/Graviton2) with auto-scaling
- **Database**: Bring your own Aurora PostgreSQL — the stack initializes roles, schemas, and JWT settings via a Lambda custom resource
- **CDN**: CloudFront distribution with smart cache invalidation for Storage
- **Edge Functions**: EFS volume mounted at `/home/deno/functions`
- **Studio**: Runs on ECS behind Kong with basic-auth at `/`
- **Networking**: CloudMap service discovery (`*.supabase.internal`), ALB restricted to CloudFront via prefix list
- **Email**: Amazon SES with optional WorkMail test domain
- **WAF**: Optional `SupabaseWafStack` (deploy in us-east-1)

## Prerequisites

You need an existing:
1. **VPC** with private subnets and a NAT gateway
2. **Aurora PostgreSQL** cluster (15.x recommended) with a Secrets Manager secret for the admin user
3. **Security group** for the Aurora cluster (the stack adds ingress rules for ECS services)

## Deploy via CDK

```bash
git clone https://github.com/supabase-community/supabase-on-aws.git
cd supabase-on-aws
yarn install

# Provide external resource references via CDK context
cdk deploy Supabase \
  -c vpcId=vpc-xxxxxxxxx \
  -c dbHostname=my-cluster.cluster-abc.us-east-1.rds.amazonaws.com \
  -c dbPort=5432 \
  -c dbAdminSecretName=my-aurora-admin-secret \
  -c dbSecurityGroupId=sg-xxxxxxxxx
```

Or pass resources as typed props in `src/main.ts`:

```typescript
new SupabaseStack(app, 'Supabase', {
  vpc: ec2.Vpc.fromLookup(this, 'Vpc', { vpcId: 'vpc-xxx' }),
  databaseEndpoint: { hostname: 'my-cluster.xxx.rds.amazonaws.com', port: 5432 },
  databaseAdminSecret: secretsmanager.Secret.fromSecretNameV2(this, 'Secret', 'my-secret'),
  databaseSecurityGroup: ec2.SecurityGroup.fromSecurityGroupId(this, 'DbSg', 'sg-xxx'),
});
```

### Optional: WAF

```bash
cdk deploy SupabaseWaf   # Must deploy in us-east-1
```

Then set the `WebAclArn` parameter on the main stack.

## Configuration

All services are configurable via CloudFormation parameters:

| Category | Parameters |
|----------|-----------|
| Auth | DisableSignup, SiteUrl, RedirectUrls, JwtExpiryLimit, PasswordMinLength |
| SMTP | Email, SenderName, SesRegion, EnableWorkMail |
| Images | AuthImageUri, RestImageUri, RealtimeImageUri, StorageImageUri, ImgproxyImageUri, PostgresMetaImageUri, StudioImageUri, FunctionsImageUri, SupavisorImageUri |
| Infrastructure | EnableHighAvailability, WebAclArn |
| Task Sizes | Per-service Fargate task sizing (micro through 4xlarge) |
| Auth Providers | Up to 3 external OAuth providers |

### Fargate Task Sizes

| Size | vCPU | Memory (MiB) |
|:--|:--|:--|
| micro | 256 | 512 |
| small | 512 | 1024 |
| medium | 1024 | 2048 |
| large | 2048 | 4096 |
| xlarge | 4096 | 8192 |
| 2xlarge | 8192 | 16384 |
| 4xlarge | 16384 | 32768 |

Set any service to `none` to disable it.

## Edge Functions

Edge Functions use an EFS file system. To deploy functions, upload them to the EFS volume at `/home/deno/functions/`. The `main` service entrypoint is at `/home/deno/functions/main`.

## Development

```bash
npm run compile         # TypeScript compilation only
npm run test            # Run Jest snapshot tests
npx jest --updateSnapshot  # Update snapshots after changes
npm run synth           # Generate CloudFormation templates
npm run eslint          # Lint
```

### IAM Policy to Deploy

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
            "Sid": "Supabase",
            "Effect": "Allow",
            "Action": [
                "application-autoscaling:*",
                "ec2:*",
                "ecs:*",
                "elasticfilesystem:*",
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
                "route53:*"
            ],
            "Resource": "*"
        },
        {
            "Sid": "CDN",
            "Effect": "Allow",
            "Action": [
                "cloudfront:*",
                "wafv2:Get*",
                "wafv2:List*"
            ],
            "Resource": "*"
        },
        {
            "Sid": "CacheManager",
            "Effect": "Allow",
            "Action": [
                "apigateway:*",
                "lambda:*",
                "logs:*",
                "sqs:*"
            ],
            "Resource": "*"
        }
    ]
}
```
