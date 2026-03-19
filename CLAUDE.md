# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Self-hosted Supabase on AWS using CDK/CloudFormation. Deploys a complete Supabase backend on ECS Fargate (Graviton2) with an **externally provided** VPC and Aurora PostgreSQL database. Uses CloudFront for CDN, EFS for Edge Functions, and SES/WorkMail for email.

**Key design decision**: The stack does NOT create its own VPC or database. These are passed in as typed construct props or resolved via CDK context. This allows the stack to be deployed into an existing infrastructure.

## Build & Development Commands

This is a Projen-managed project. Scripts in package.json are auto-generated from `.projenrc.js` — do not edit package.json directly.

```bash
npx projen              # Regenerate project files from .projenrc.js
npm run build           # Full build (compile + test + synth)
npm run compile         # TypeScript compilation only
npm run synth           # Generate CloudFormation templates (output in cdk.out/)
npm run test            # Run Jest snapshot tests
npm run test:watch      # Jest in watch mode
npm run eslint          # Lint with ESLint
cdk deploy Supabase     # Deploy stack to AWS
cdk diff                # Preview changes
```

Node 18.x required (see .nvmrc).

## Architecture

**Two stacks**: `SupabaseStack` (main) and `SupabaseWafStack` (optional WAF for CloudFront, must deploy in us-east-1).

**Entry point**: `src/main.ts` creates both stacks. The main stack is defined in `src/supabase-stack.ts`.

**External resources** (passed via props or CDK context):
- VPC (`vpcId` context key or `vpc` prop)
- Aurora PostgreSQL endpoint (`dbHostname`, `dbPort` context keys or `databaseEndpoint` prop)
- Database admin secret (`dbAdminSecretName` context key or `databaseAdminSecret` prop)
- Database security group (`dbSecurityGroupId` context key or `databaseSecurityGroup` prop)

**CDK Constructs** in `src/`:
- `supabase-db-init/` — Lambda custom resource to initialize the external database (roles, schemas, JWT settings, user passwords)
- `supabase-cdn/` — CloudFront distribution with smart cache invalidation via SQS
- `ecs-patterns.ts` — Reusable ECS Fargate service pattern with optional EFS volume support
- `amazon-ses-smtp/` — SES SMTP credential generation
- `aws-workmail/` — WorkMail organization setup
- `json-web-token/` — JWT generation for Supabase auth (anon/service_role keys)

**10 ECS Fargate services**:
| Service | Image | Port |
|---------|-------|------|
| Kong | kong/kong:3.9.1 (custom container) | 8000 |
| Auth (GoTrue) | supabase/gotrue:v2.186.0 | 9999 |
| PostgREST | postgrest/postgrest:v14.6 | 3000 |
| Realtime | supabase/realtime:v2.76.5 | 4000 |
| Storage | supabase/storage-api:v1.44.2 | 5000 |
| Imgproxy | darthsim/imgproxy:v3.30.1 | 5001 |
| postgres-meta | supabase/postgres-meta:v0.95.2 | 8080 |
| Studio | supabase/studio:2026.03.16-sha-5528817 | 3000 |
| Edge Functions | supabase/edge-runtime:v1.71.2 | 9000 |
| Supavisor | supabase/supavisor:2.7.4 | 4000 |

**Service discovery**: ECS services register as `*.supabase.internal`.

**Custom containers** in `containers/`:
- `kong/` — Custom Kong 3.9.1 API gateway image with declarative config and awk-based env var substitution
- `supavisor/` — Supavisor pooler configuration (pooler.exs)

**Not included (deferred)**: Vector, Logflare/Analytics

## Key Design Patterns

- Heavy use of CloudFormation parameters and conditions for runtime configuration (enable/disable components, sizing)
- `cdk-bootstrapless-synthesizer` enables publishing CFN templates to S3 without CDK bootstrap
- Lambda custom resources handle complex provisioning (DB init, secret generation, cache invalidation)
- HS256 symmetric JWT only (no opaque sb_ keys or ES256)
- Edge Functions use EFS for function code storage
- Studio runs on ECS behind Kong (basic-auth protected at `/`)
- All database connections go through the external Aurora security group

## Testing

Single snapshot test in `test/main.test.ts` validates synthesized CloudFormation output. The test creates a mock VPC and DB resources since the stack expects external infrastructure. Update snapshots with:

```bash
npx jest --updateSnapshot
```

## Linting

ESLint config: 150 char line limit, single quotes, semicolons required.
