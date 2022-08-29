import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { SupabaseService } from './supabase-service';

interface ParameterGroup {
  Label: { default: string };
  Parameters: string[];
}

interface CfnInterface {
  ParameterGroups: ParameterGroup[];
  ParameterLabels: {
    [key: string]: { default: string };
  };
}

export interface ExternalAuthProviderProps {
  redirectUri: string;
  authService: SupabaseService;
  metadata: { [key: string]: any };
}

export class ExternalAuthProvider extends Construct {

  constructor(scope: Construct, id: string, props: ExternalAuthProviderProps) {
    super(scope, id);

    const { redirectUri, authService, metadata } = props;
    const authServiceId = authService.node.id;
    const goTrue = authService.ecsService.taskDefinition.defaultContainer!;

    const enabledParameter = new cdk.CfnParameter(this, 'Enabled', {
      description: 'Whether this external provider is enabled or not',
      type: 'String',
      default: 'false',
      allowedValues: ['true', 'false'],
    });

    const clientIdParameter = new cdk.CfnParameter(this, 'ClientId', {
      description: 'The OAuth2 Client ID registered with the external provider.',
      type: 'String',
      default: 'replace-with-your-client-id',
    });

    const secretParameter = new cdk.CfnParameter(this, 'Secret', {
      description: 'The OAuth2 Client Secret provided by the external provider when you registered.',
      type: 'String',
      default: 'replace-with-your-client-secret',
      noEcho: true,
    });

    const clientIdSsmParameter = new StringParameter(this, 'ClientIdParameter', {
      description: 'The OAuth2 Client ID registered with the external provider.',
      simpleName: false,
      parameterName: `/${cdk.Aws.STACK_NAME}/${authServiceId}/External/${id}/ClientId`,
      stringValue: clientIdParameter.valueAsString,
    });
    const secretSsmParameter = new StringParameter(this, 'SecretParameter', {
      description: 'The OAuth2 Client Secret provided by the external provider when you registered.',
      simpleName: false,
      parameterName: `/${cdk.Aws.STACK_NAME}/${authServiceId}/External/${id}/Secret`,
      stringValue: secretParameter.valueAsString,
    });

    const idpName = id.toUpperCase();
    goTrue.addEnvironment(`GOTRUE_EXTERNAL_${idpName}_ENABLED`, enabledParameter.valueAsString);
    goTrue.addEnvironment(`GOTRUE_EXTERNAL_${idpName}_REDIRECT_URI`, redirectUri);
    // TODO: Pass parameters using Parameter Store.
    // addSecret is not supported - https://github.com/aws/aws-cdk/issues/18959
    goTrue.addEnvironment(`GOTRUE_EXTERNAL_${idpName}_CLIENT_ID`, clientIdParameter.valueAsString);
    goTrue.addEnvironment(`GOTRUE_EXTERNAL_${idpName}_SECRET`, secretParameter.valueAsString);

    const { ParameterGroups, ParameterLabels } = metadata['AWS::CloudFormation::Interface'] as CfnInterface;
    ParameterGroups.push({
      Label: { default: `Supabase - External Auth Provider - ${id}` },
      Parameters: [enabledParameter.logicalId, clientIdParameter.logicalId, secretParameter.logicalId],
    });
    ParameterLabels[enabledParameter.logicalId] = { default: `${id} Enabled` };
    ParameterLabels[clientIdParameter.logicalId] = { default: `${id} Client ID` };
    ParameterLabels[secretParameter.logicalId] = { default: `${id} Client Secret` };
  }
};