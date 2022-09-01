import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as events from 'aws-cdk-lib/aws-events';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { SupabaseService, SupabaseServiceProps } from './supabase-service';

type authProvicer = 'Apple'|'Azure'|'Bitbucket'|'Discord'|'Facebook'|'GitHub'|'GitLab'|'Google'|'Keycloak'|'Linkedin'|'Notion'|'Spotify'|'Slack'|'Twitch'|'Twitter'|'WorkOS';

interface SupabaseAuthProps extends SupabaseServiceProps {
  apiExternalUrl: string;
  externalAuthProviders: authProvicer[];
}

export class SupabaseAuth extends SupabaseService {
  externalAuthProviders: AuthProvicer[] = [];

  constructor(scope: Construct, id: string, props: SupabaseAuthProps) {

    const serviceName = id;
    const redirectUri = `${props.apiExternalUrl}/auth/v1/callback`;

    const env = props.containerDefinition.environment!;
    const secrets = props.containerDefinition.secrets!;

    env.API_EXTERNAL_URL = props.apiExternalUrl;
    const authProvicers: AuthProvicer[] = [];

    for (let i in props.externalAuthProviders) {
      const providerName = props.externalAuthProviders[i];
      const authProvicer = new AuthProvicer(scope, providerName, serviceName);
      const upperCaseProviderName = providerName.toUpperCase();
      env[`GOTRUE_EXTERNAL_${upperCaseProviderName}_ENABLED`] = authProvicer.enabledParameter.valueAsString;
      env[`GOTRUE_EXTERNAL_${upperCaseProviderName}_REDIRECT_URI`] = redirectUri;
      secrets[`GOTRUE_EXTERNAL_${upperCaseProviderName}_CLIENT_ID`] = ecs.Secret.fromSsmParameter(authProvicer.clientId);
      secrets[`GOTRUE_EXTERNAL_${upperCaseProviderName}_SECRET`] = ecs.Secret.fromSsmParameter(authProvicer.secret);
      authProvicers.push(authProvicer);
    }

    super(scope, id, props);

    this.externalAuthProviders = authProvicers;

    new events.Rule(this, 'ParameterChange', {
      description: `Supabase - Force deploy ${serviceName}, when parameters changed`,
      eventPattern: {
        source: ['aws.ssm'],
        detailType: ['Parameter Store Change'],
        detail: {
          name: [{ prefix: `/${cdk.Aws.STACK_NAME}/${serviceName}/` }],
          operation: ['Update'],
        },
      },
      targets: [this.forceDeployFunction],
    });

  }

}

class AuthProvicer extends Construct {
  name: string;
  enabledParameter: cdk.CfnParameter;
  clientIdParameter: cdk.CfnParameter;
  secretParameter: cdk.CfnParameter;
  clientId: StringParameter;
  secret: StringParameter;

  constructor(scope: Construct, id: string, serviceName: string) {
    super(scope, id);

    this.name = id;

    this.enabledParameter = new cdk.CfnParameter(this, 'EnabledParameter', {
      description: 'Whether this external provider is enabled or not',
      type: 'String',
      default: 'false',
      allowedValues: ['true', 'false'],
    });

    this.clientIdParameter = new cdk.CfnParameter(this, 'ClientIdParameter', {
      description: 'The OAuth2 Client ID registered with the external provider.',
      type: 'String',
      default: 'replace-with-your-client-id',
    });

    this.secretParameter = new cdk.CfnParameter(this, 'SecretParameter', {
      description: 'The OAuth2 Client Secret provided by the external provider when you registered.',
      type: 'String',
      default: 'replace-with-your-client-secret',
      noEcho: true,
    });

    this.clientId = new StringParameter(this, 'ClientId', {
      description: 'The OAuth2 Client ID registered with the external provider.',
      simpleName: false,
      parameterName: `/${cdk.Aws.STACK_NAME}/${serviceName}/External/${id}/ClientId`,
      stringValue: this.clientIdParameter.valueAsString,
    });

    this.secret = new StringParameter(this, 'Secret', {
      description: 'The OAuth2 Client Secret provided by the external provider when you registered.',
      simpleName: false,
      parameterName: `/${cdk.Aws.STACK_NAME}/${serviceName}/External/${id}/Secret`,
      stringValue: this.secretParameter.valueAsString,
    });

  }
}
