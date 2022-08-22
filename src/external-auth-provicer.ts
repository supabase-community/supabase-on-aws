import * as cdk from 'aws-cdk-lib';
//import { StringParameter } from 'aws-cdk-lib/aws-ssm';
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
  apiExternalUrl: string;
  authService: SupabaseService;
  metadata: { [key: string]: any };
}

export class ExternalAuthProvider extends Construct {

  constructor(scope: Construct, id: string, props: ExternalAuthProviderProps) {
    super(scope, id);

    const { apiExternalUrl, authService, metadata } = props;
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
      noEcho: true,
    });

    const secretParameter = new cdk.CfnParameter(this, 'Secret', {
      description: 'The OAuth2 Client Secret provided by the external provider when you registered.',
      type: 'String',
      default: 'replace-with-your-client-secret',
      noEcho: true,
    });

    // Todo: CDK does not support addSecret, addEnvironment only allowed.
    //const clientId = new StringParameter(this, 'ClientId', {
    //  description: 'The OAuth2 Client ID registered with the external provider.',
    //  parameterName: `/${cdk.Aws.STACK_NAME}/Auth/External/${id}/ClientId`,
    //  stringValue: clientIdParameter.valueAsString,
    //});
    //const secret = new StringParameter(this, 'ClientId', {
    //  description: 'The OAuth2 Client Secret provided by the external provider when you registered.',
    //  parameterName: `/${cdk.Aws.STACK_NAME}/Auth/External/${id}/ClientId`,
    //  stringValue: secretParameter.valueAsString,
    //});

    goTrue.addEnvironment(`GOTRUE_EXTERNAL_${id.toUpperCase()}_ENABLED`, enabledParameter.valueAsString);
    goTrue.addEnvironment(`GOTRUE_EXTERNAL_${id.toUpperCase()}_CLIENT_ID`, clientIdParameter.valueAsString);
    goTrue.addEnvironment(`GOTRUE_EXTERNAL_${id.toUpperCase()}_SECRE`, secretParameter.valueAsString);
    goTrue.addEnvironment(`GOTRUE_EXTERNAL_${id.toUpperCase()}_REDIRECT_URI`, `${apiExternalUrl}/auth/v1/callback`);

    const { ParameterGroups, ParameterLabels } = metadata['AWS::CloudFormation::Interface'] as CfnInterface;
    ParameterGroups.push({
      Label: { default: `External Auth Provider - ${id}` },
      Parameters: [enabledParameter.logicalId, clientIdParameter.logicalId, secretParameter.logicalId],
    });
    ParameterLabels[enabledParameter.logicalId] = { default: `${id} Enabled` };
    ParameterLabels[clientIdParameter.logicalId] = { default: `${id} Client ID` };
    ParameterLabels[secretParameter.logicalId] = { default: `${id} Client Secret` };
  }
};