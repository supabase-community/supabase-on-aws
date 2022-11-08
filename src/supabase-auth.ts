import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { SupabaseService, SupabaseServiceProps } from './supabase-service';

interface SupabaseAuthProps extends SupabaseServiceProps {
  authProviderCount: number;
}

export class SupabaseAuth extends SupabaseService {
  apiExternalUrl: string;
  providers: AuthProvider[] = [];

  constructor(scope: Construct, id: string, props: SupabaseAuthProps) {

    super(scope, id, props);

    this.apiExternalUrl = props.taskImageOptions.environment!.API_EXTERNAL_URL!;

    for (let i = 0; i < props.authProviderCount; i++) {
      const authProvider = new AuthProvider(this, `Provider${i+1}`);
      this.providers.push(authProvider);
    }
  }
}

class AuthProvider extends Construct {
  name: cdk.CfnParameter;
  clientId: cdk.CfnParameter;
  secret: cdk.CfnParameter;

  constructor(scope: SupabaseAuth, id: string) {
    super(scope, id);

    const redirectUri = `${scope.apiExternalUrl}/auth/v1/callback`;

    this.name = new cdk.CfnParameter(this, 'Name', {
      description: 'External Auth Provider Name',
      type: 'String',
      default: '',
      allowedValues: ['', 'APPLE', 'AZURE', 'BITBUCKET', 'DISCORD', 'FACEBOOK', 'GITHUB', 'GITLAB', 'GOOGLE', 'KEYCLOAK', 'LINKEDIN', 'NOTION', 'SPOTIFY', 'SLACK', 'TWITCH', 'TWITTER', 'WORKOS'],
    });

    const enabled = new cdk.CfnCondition(this, 'Enabled', { expression: cdk.Fn.conditionNot(cdk.Fn.conditionEquals(this.name, '')) });

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

    const parameterPrefix = `/${cdk.Aws.STACK_NAME}/${scope.node.id}/External/`;

    const clientIdParameter = new StringParameter(this, 'ClientIdParameter', {
      description: 'The OAuth2 Client ID registered with the external provider.',
      simpleName: false,
      parameterName: parameterPrefix + cdk.Fn.conditionIf(enabled.logicalId, this.name.valueAsString, id).toString() + '/ClientId',
      stringValue: cdk.Fn.conditionIf(enabled.logicalId, this.clientId.valueAsString, 'null').toString(),
    });

    const secretParameter = new StringParameter(this, 'SecretParameter', {
      description: 'The OAuth2 Client Secret provided by the external provider when you registered.',
      simpleName: false,
      parameterName: parameterPrefix + cdk.Fn.conditionIf(enabled.logicalId, this.name.valueAsString, id).toString() + '/Secret',
      stringValue: cdk.Fn.conditionIf(enabled.logicalId, this.secret.valueAsString, 'null').toString(),
    });

    const container = scope.service.taskDefinition.defaultContainer!;

    const envPrefix = 'GOTRUE_EXTERNAL_' + cdk.Fn.conditionIf(enabled.logicalId, this.name, id).toString();

    container.addEnvironment(`${envPrefix}_ENABLED`, cdk.Fn.conditionIf(enabled.logicalId, 'true', 'false').toString());
    container.addEnvironment(`${envPrefix}_REDIRECT_URI`, redirectUri);
    container.addSecret(`${envPrefix}_CLIENT_ID`, ecs.Secret.fromSsmParameter(clientIdParameter));
    container.addSecret(`${envPrefix}_SECRET`, ecs.Secret.fromSsmParameter(secretParameter));

    new cdk.CfnRule(this, 'CheckClientId', {
      ruleCondition: enabled.expression,
      assertions: [{
        assert: cdk.Fn.conditionNot(cdk.Fn.conditionEquals(this.clientId, '')),
        assertDescription: `${id} Client Id is must not null, if ${id} is enabled as external auth provider.`,
      }],
    });

    new cdk.CfnRule(this, 'CheckSecret', {
      ruleCondition: enabled.expression,
      assertions: [{
        assert: cdk.Fn.conditionNot(cdk.Fn.conditionEquals(this.secret, '')),
        assertDescription: `${id} Client Secret is must not null, if ${id} is enabled as external auth provider.`,
      }],
    });

  }
}
