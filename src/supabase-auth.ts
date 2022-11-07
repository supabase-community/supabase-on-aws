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
    const container = this.service.taskDefinition.defaultContainer!;
    const envPrefix = `GOTRUE_EXTERNAL_${name.toUpperCase()}`;
    container.addEnvironment(`${envPrefix}_ENABLED`, authProvicer.enabled.valueAsString);
    container.addEnvironment(`${envPrefix}_REDIRECT_URI`, this.redirectUri);
    container.addSecret(`${envPrefix}_CLIENT_ID`, ecs.Secret.fromSsmParameter(authProvicer.clientIdParameter));
    container.addSecret(`${envPrefix}_SECRET`, ecs.Secret.fromSsmParameter(authProvicer.secretParameter));
    this.externalAuthProvider[name] = authProvicer;
    return authProvicer;
  }

}

interface AuthProvicerProps {
  parameterPrefix: string;
}

class AuthProvicer extends Construct {
  name: string;
  enabled: cdk.CfnParameter;
  clientId: cdk.CfnParameter;
  secret: cdk.CfnParameter;
  clientIdParameter: StringParameter;
  secretParameter: StringParameter;

  constructor(scope: Construct, id: string, props: AuthProvicerProps) {
    super(scope, id);

    this.name = id;
    const { parameterPrefix } = props;

    this.enabled = new cdk.CfnParameter(this, 'Enabled', {
      description: 'Whether this external provider is enabled or not',
      type: 'String',
      default: 'false',
      allowedValues: ['true', 'false'],
    });

    const enabledCondition = new cdk.CfnCondition(this, 'EnabledCondition', { expression: cdk.Fn.conditionEquals(this.enabled, 'true') });

    this.clientId = new cdk.CfnParameter(this, 'ClientId', {
      description: 'The OAuth2 Client ID registered with the external provider.',
      type: 'String',
      default: '',
    });

    this.secret = new cdk.CfnParameter(this, 'Secret', {
      description: 'The OAuth2 Client Secret provided by the external provider when you registered.',
      type: 'String',
      default: '',
      noEcho: true,
    });

    this.clientIdParameter = new StringParameter(this, 'ClientIdParameter', {
      description: 'The OAuth2 Client ID registered with the external provider.',
      simpleName: false,
      parameterName: `${parameterPrefix}/ClientId`,
      stringValue: cdk.Fn.conditionIf(enabledCondition.logicalId, this.clientId.valueAsString, 'null').toString(),
    });

    this.secretParameter = new StringParameter(this, 'SecretParameter', {
      description: 'The OAuth2 Client Secret provided by the external provider when you registered.',
      simpleName: false,
      parameterName: `${parameterPrefix}/Secret`,
      stringValue: cdk.Fn.conditionIf(enabledCondition.logicalId, this.secret.valueAsString, 'null').toString(),
    });

    new cdk.CfnRule(this, 'CheckClientId', {
      ruleCondition: enabledCondition.expression,
      assertions: [{
        assert: cdk.Fn.conditionNot(cdk.Fn.conditionEquals(this.clientId, '')),
        assertDescription: `${id} Client Id is must not null, if ${id} is enabled as external auth provider.`,
      }],
    });

    new cdk.CfnRule(this, 'CheckSecret', {
      ruleCondition: enabledCondition.expression,
      assertions: [{
        assert: cdk.Fn.conditionNot(cdk.Fn.conditionEquals(this.secret, '')),
        assertDescription: `${id} Client Secret is must not null, if ${id} is enabled as external auth provider.`,
      }],
    });

  }
}
