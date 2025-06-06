import { Construct } from 'constructs';
import { UserPoolIdentityProviderProps } from './base';
import { CfnUserPoolIdentityProvider } from '../cognito.generated';
import { UserPoolIdentityProviderBase } from './private/user-pool-idp-base';
import { addConstructMetadata } from '../../../core/lib/metadata-resource';
import { propertyInjectable } from '../../../core/lib/prop-injectable';

/**
 * Properties to initialize UserPoolAmazonIdentityProvider
 */
export interface UserPoolIdentityProviderAmazonProps extends UserPoolIdentityProviderProps {
  /**
   * The client id recognized by Login with Amazon APIs.
   * @see https://developer.amazon.com/docs/login-with-amazon/security-profile.html#client-identifier
   */
  readonly clientId: string;
  /**
   * The client secret to be accompanied with clientId for Login with Amazon APIs to authenticate the client.
   * @see https://developer.amazon.com/docs/login-with-amazon/security-profile.html#client-identifier
   */
  readonly clientSecret: string;
  /**
   * The types of user profile data to obtain for the Amazon profile.
   * @see https://developer.amazon.com/docs/login-with-amazon/customer-profile.html
   * @default [ profile ]
   */
  readonly scopes?: string[];
}

/**
 * Represents an identity provider that integrates with Login with Amazon
 * @resource AWS::Cognito::UserPoolIdentityProvider
 */
@propertyInjectable
export class UserPoolIdentityProviderAmazon extends UserPoolIdentityProviderBase {
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string = 'aws-cdk-lib.aws-cognito.UserPoolIdentityProviderAmazon';
  public readonly providerName: string;

  constructor(scope: Construct, id: string, props: UserPoolIdentityProviderAmazonProps) {
    super(scope, id, props);
    // Enhanced CDK Analytics Telemetry
    addConstructMetadata(this, props);

    const scopes = props.scopes ?? ['profile'];

    const resource = new CfnUserPoolIdentityProvider(this, 'Resource', {
      userPoolId: props.userPool.userPoolId,
      providerName: 'LoginWithAmazon', // must be 'LoginWithAmazon' when the type is 'LoginWithAmazon'
      providerType: 'LoginWithAmazon',
      providerDetails: {
        client_id: props.clientId,
        client_secret: props.clientSecret,
        authorize_scopes: scopes.join(' '),
      },
      attributeMapping: super.configureAttributeMapping(),
    });

    this.providerName = super.getResourceNameAttribute(resource.ref);
  }
}
