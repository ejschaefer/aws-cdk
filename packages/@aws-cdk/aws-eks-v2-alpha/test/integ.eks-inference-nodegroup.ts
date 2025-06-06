/// !cdk-integ pragma:disable-update-workflow
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { App, Stack } from 'aws-cdk-lib';
import * as integ from '@aws-cdk/integ-tests-alpha';
import * as eks from '../lib';
import { KubectlV32Layer } from '@aws-cdk/lambda-layer-kubectl-v32';
import { IAM_OIDC_REJECT_UNAUTHORIZED_CONNECTIONS } from 'aws-cdk-lib/cx-api';

class EksClusterInferenceStack extends Stack {
  constructor(scope: App, id: string) {
    super(scope, id);

    // just need one nat gateway to simplify the test
    const vpc = new ec2.Vpc(this, 'Vpc', { maxAzs: 2, natGateways: 1, restrictDefaultSecurityGroup: false });

    const cluster = new eks.Cluster(this, 'Cluster', {
      vpc,
      version: eks.KubernetesVersion.V1_32,
      kubectlProviderOptions: {
        kubectlLayer: new KubectlV32Layer(this, 'kubectlLayer'),
      },
      albController: {
        version: eks.AlbControllerVersion.V2_8_2,
      },
      defaultCapacityType: eks.DefaultCapacityType.NODEGROUP,
    });

    cluster.addNodegroupCapacity('InferenceInstances', {
      instanceTypes: [new ec2.InstanceType('inf1.2xlarge')],
    });

    cluster.addNodegroupCapacity('Inference2Instances', {
      instanceTypes: [new ec2.InstanceType('inf2.xlarge')],
    });
  }
}

const app = new App({
  postCliContext: {
    [IAM_OIDC_REJECT_UNAUTHORIZED_CONNECTIONS]: false,
    '@aws-cdk/aws-lambda:createNewPoliciesWithAddToRolePolicy': true,
    '@aws-cdk/aws-lambda:useCdkManagedLogGroup': false,
  },
});
const stack = new EksClusterInferenceStack(app, 'aws-cdk-eks-cluster-inference-nodegroup');
new integ.IntegTest(app, 'aws-cdk-eks-cluster-interence-nodegroup-integ', {
  testCases: [stack],
  // Test includes assets that are updated weekly. If not disabled, the upgrade PR will fail.
  diffAssets: false,
  cdkCommandOptions: {
    deploy: {
      args: {
        rollback: true,
      },
    },
  },
});
