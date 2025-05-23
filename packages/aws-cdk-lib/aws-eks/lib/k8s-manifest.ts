import { Construct, Node } from 'constructs';
import { AlbScheme } from './alb-controller';
import { ICluster } from './cluster';
import { KubectlProvider } from './kubectl-provider';
import { CustomResource, Stack } from '../../core';
import { propertyInjectable } from '../../core/lib/prop-injectable';

const PRUNE_LABEL_PREFIX = 'aws.cdk.eks/prune-';

/**
 * Options for `KubernetesManifest`.
 */
export interface KubernetesManifestOptions {
  /**
   * When a resource is removed from a Kubernetes manifest, it no longer appears
   * in the manifest, and there is no way to know that this resource needs to be
   * deleted. To address this, `kubectl apply` has a `--prune` option which will
   * query the cluster for all resources with a specific label and will remove
   * all the labeld resources that are not part of the applied manifest. If this
   * option is disabled and a resource is removed, it will become "orphaned" and
   * will not be deleted from the cluster.
   *
   * When this option is enabled (default), the construct will inject a label to
   * all Kubernetes resources included in this manifest which will be used to
   * prune resources when the manifest changes via `kubectl apply --prune`.
   *
   * The label name will be `aws.cdk.eks/prune-<ADDR>` where `<ADDR>` is the
   * 42-char unique address of this construct in the construct tree. Value is
   * empty.
   *
   * @see
   * https://kubernetes.io/docs/tasks/manage-kubernetes-objects/declarative-config/#alternative-kubectl-apply-f-directory-prune-l-your-label
   *
   * @default - based on the prune option of the cluster, which is `true` unless
   * otherwise specified.
   */
  readonly prune?: boolean;

  /**
   * A flag to signify if the manifest validation should be skipped
   *
   * @default false
   */
  readonly skipValidation?: boolean;

  /**
   * Automatically detect `Ingress` resources in the manifest and annotate them so they
   * are picked up by an ALB Ingress Controller.
   *
   * @default false
   */
  readonly ingressAlb?: boolean;

  /**
   * Specify the ALB scheme that should be applied to `Ingress` resources.
   * Only applicable if `ingressAlb` is set to `true`.
   *
   * @default AlbScheme.INTERNAL
   */
  readonly ingressAlbScheme?: AlbScheme;

}

/**
 * Properties for KubernetesManifest
 */
export interface KubernetesManifestProps extends KubernetesManifestOptions {
  /**
   * The EKS cluster to apply this manifest to.
   *
   * [disable-awslint:ref-via-interface]
   */
  readonly cluster: ICluster;

  /**
   * The manifest to apply.
   *
   * Consists of any number of child resources.
   *
   * When the resources are created/updated, this manifest will be applied to the
   * cluster through `kubectl apply` and when the resources or the stack is
   * deleted, the resources in the manifest will be deleted through `kubectl delete`.
   *
   * @example
   *
   * [{
   *   apiVersion: 'v1',
   *   kind: 'Pod',
   *   metadata: { name: 'mypod' },
   *   spec: {
   *     containers: [ { name: 'hello', image: 'paulbouwer/hello-kubernetes:1.5', ports: [ { containerPort: 8080 } ] } ]
   *   }
   * }]
   *
   */
  readonly manifest: Record<string, any>[];

  /**
   * Overwrite any existing resources.
   *
   * If this is set, we will use `kubectl apply` instead of `kubectl create`
   * when the resource is created. Otherwise, if there is already a resource
   * in the cluster with the same name, the operation will fail.
   *
   * @default false
   */
  readonly overwrite?: boolean;
}

/**
 * Represents a manifest within the Kubernetes system.
 *
 * Alternatively, you can use `cluster.addManifest(resource[, resource, ...])`
 * to define resources on this cluster.
 *
 * Applies/deletes the manifest using `kubectl`.
 */
@propertyInjectable
export class KubernetesManifest extends Construct {
  /**
   * Uniquely identifies this class.
   */
  public static readonly PROPERTY_INJECTION_ID: string = 'aws-cdk-lib.aws-eks.KubernetesManifest';

  /**
   * The CloudFormation resource type.
   */
  public static readonly RESOURCE_TYPE = 'Custom::AWSCDK-EKS-KubernetesResource';

  constructor(scope: Construct, id: string, props: KubernetesManifestProps) {
    super(scope, id);

    const stack = Stack.of(this);
    const provider = KubectlProvider.getOrCreate(this, props.cluster);

    const prune = props.prune ?? props.cluster.prune;
    const pruneLabel = prune
      ? this.injectPruneLabel(props.manifest)
      : undefined;

    if (props.ingressAlb ?? false) {
      this.injectIngressAlbAnnotations(props.manifest, props.ingressAlbScheme ?? AlbScheme.INTERNAL);
    }

    const customResource = new CustomResource(this, 'Resource', {
      serviceToken: provider.serviceToken,
      resourceType: KubernetesManifest.RESOURCE_TYPE,
      properties: {
        // `toJsonString` enables embedding CDK tokens in the manifest and will
        // render a CloudFormation-compatible JSON string (similar to
        // StepFunctions, CloudWatch Dashboards etc).
        Manifest: stack.toJsonString(props.manifest),
        ClusterName: props.cluster.clusterName,
        RoleArn: provider.roleArn, // TODO: bake into provider's environment
        PruneLabel: pruneLabel,
        Overwrite: props.overwrite,
        SkipValidation: props.skipValidation,
      },
    });

    this.node.defaultChild = customResource.node.defaultChild;
  }

  /**
   * Injects a generated prune label to all resources in this manifest. The
   * label name will be `awscdk.eks/manifest-ADDR` where `ADDR` is the address
   * of the construct in the construct tree.
   *
   * @returns the label name
   */
  private injectPruneLabel(manifest: Record<string, any>[]): string {
    // max label name is 64 chars and addrs is always 42.
    const pruneLabel = PRUNE_LABEL_PREFIX + Node.of(this).addr;

    for (const resource of manifest) {
      // skip resource if it's not an object or if it does not have a "kind"
      if (typeof(resource) !== 'object' || !resource.kind) {
        continue;
      }

      if (!resource.metadata) {
        resource.metadata = {};
      }

      if (!resource.metadata.labels) {
        resource.metadata.labels = {};
      }

      resource.metadata.labels = {
        [pruneLabel]: '',
        ...resource.metadata.labels,
      };
    }

    return pruneLabel;
  }

  /**
   * Inject the necessary ingress annotations if possible (and requested).
   *
   * @see https://kubernetes-sigs.github.io/aws-load-balancer-controller/v2.2/guide/ingress/annotations/
   */
  private injectIngressAlbAnnotations(manifest: Record<string, any>[], scheme: AlbScheme) {
    for (const resource of manifest) {
      // skip resource if it's not an object or if it does not have a "kind"
      if (typeof(resource) !== 'object' || !resource.kind) {
        continue;
      }

      if (resource.kind === 'Ingress') {
        resource.metadata.annotations = {
          'kubernetes.io/ingress.class': 'alb',
          'alb.ingress.kubernetes.io/scheme': scheme,
          ...resource.metadata.annotations,
        };
      }
    }
  }
}
