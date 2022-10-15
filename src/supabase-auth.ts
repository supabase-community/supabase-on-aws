import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { SupabaseService, SupabaseServiceProps } from './supabase-service';

export type AuthProvicerName = 'Apple'|'Azure'|'Bitbucket'|'Discord'|'Facebook'|'GitHub'|'GitLab'|'Google'|'Keycloak'|'Linkedin'|'Notion'|'Spotify'|'Slack'|'Twitch'|'Twitter'|'WorkOS';

export class SupabaseAuth extends SupabaseService {
  redirectUri: string;
  externalAuthProvider: { [name in AuthProvicerName]?: AuthProvicer } = {};

  constructor(scope: Construct, id: string, props: SupabaseServiceProps) {

    super(scope, id, props);

    const apiExternalUrl = props.taskImageOptions.environment!.API_EXTERNAL_URL!;
    this.redirectUri = `${apiExternalUrl}/auth/v1/callback`;

  }

  addExternalAuthProvider(name: AuthProvicerName) {
    const authProvicer = new AuthProvicer(this, name, { parameterPrefix: `/${cdk.Aws.STACK_NAME}/${this.node.id}/External/${name}` });
    const container = this.ecsService.taskDefinition.defaultContainer!;
    const envPrefix = `GOTRUE_EXTERNAL_${name.toUpperCase()}`;
    container.addEnvironment(`${envPrefix}_ENABLED`, authProvicer.enabledParameter.valueAsString);
    container.addEnvironment(`${envPrefix}_REDIRECT_URI`, this.redirectUri);
    container.addSecret(`${envPrefix}_CLIENT_ID`, ecs.Secret.fromSsmParameter(authProvicer.clientId));
    container.addSecret(`${envPrefix}_SECRET`, ecs.Secret.fromSsmParameter(authProvicer.secret));
    this.externalAuthProvider[name] = authProvicer;
    return authProvicer;
  }

}

interface AuthProvicerProps {
  parameterPrefix: string;
}

class AuthProvicer extends Construct {
  name: string;
  enabledParameter: cdk.CfnParameter;
  clientIdParameter: cdk.CfnParameter;
  secretParameter: cdk.CfnParameter;
  clientId: StringParameter;
  secret: StringParameter;

  constructor(scope: Construct, id: string, props: AuthProvicerProps) {
    super(scope, id);

    this.name = id;
    const { parameterPrefix } = props;

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
      parameterName: `${parameterPrefix}/ClientId`,
      stringValue: this.clientIdParameter.valueAsString,
    });

    this.secret = new StringParameter(this, 'Secret', {
      description: 'The OAuth2 Client Secret provided by the external provider when you registered.',
      simpleName: false,
      parameterName: `${parameterPrefix}/Secret`,
      stringValue: this.secretParameter.valueAsString,
    });

  }
}
