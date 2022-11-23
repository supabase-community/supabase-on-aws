import * as cdk from 'aws-cdk-lib';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export class AuthProvider extends Construct {
  readonly id: string;
  readonly name: cdk.CfnParameter;
  readonly clientId: cdk.CfnParameter;
  readonly secret: cdk.CfnParameter;
  readonly clientIdParameter: StringParameter
  readonly secretParameter: StringParameter
  readonly enabled: string;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.name = new cdk.CfnParameter(this, 'Name', {
      description: 'External Auth Provider Name',
      type: 'String',
      default: '',
      allowedValues: ['', 'APPLE', 'AZURE', 'BITBUCKET', 'DISCORD', 'FACEBOOK', 'GITHUB', 'GITLAB', 'GOOGLE', 'KEYCLOAK', 'LINKEDIN', 'NOTION', 'SPOTIFY', 'SLACK', 'TWITCH', 'TWITTER', 'WORKOS'],
    });

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

    const enabled = new cdk.CfnCondition(this, 'Enabled', { expression: cdk.Fn.conditionNot(cdk.Fn.conditionEquals(this.name, '')) });
    this.enabled = cdk.Fn.conditionIf(enabled.logicalId, 'true', 'false').toString()

    // If provider name is not specified, dummy provider name is configured such as PROVIDER1.
    const dummyProviderName = id.toUpperCase();
    this.id = cdk.Fn.conditionIf(enabled.logicalId, this.name, dummyProviderName).toString();

    const parameterPrefix = `/${cdk.Aws.STACK_NAME}/${scope.node.id}/External/`;

    this.clientIdParameter = new StringParameter(this, 'ClientIdParameter', {
      description: 'The OAuth2 Client ID registered with the external provider.',
      simpleName: false,
      parameterName: parameterPrefix + cdk.Fn.conditionIf(enabled.logicalId, this.name.valueAsString, id).toString() + '/ClientId',
      stringValue: cdk.Fn.conditionIf(enabled.logicalId, this.clientId.valueAsString, 'null').toString(),
    });

    this.secretParameter = new StringParameter(this, 'SecretParameter', {
      description: 'The OAuth2 Client Secret provided by the external provider when you registered.',
      simpleName: false,
      parameterName: parameterPrefix + cdk.Fn.conditionIf(enabled.logicalId, this.name.valueAsString, id).toString() + '/Secret',
      stringValue: cdk.Fn.conditionIf(enabled.logicalId, this.secret.valueAsString, 'null').toString(),
    });

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
