import { IConstruct } from 'constructs';
import { addToDeadLetterQueueResourcePolicy, bindBaseTargetConfig, singletonEventRole, TargetBaseProps } from './util';
import * as events from '../../aws-events';
import * as iam from '../../aws-iam';
import { Names, Token, ValidationError } from '../../core';

/**
 * Customize the Batch Job Event Target
 */
export interface BatchJobProps extends TargetBaseProps {
  /**
   * The event to send to the Lambda
   *
   * This will be the payload sent to the Lambda Function.
   *
   * @default the entire EventBridge event
   */
  readonly event?: events.RuleTargetInput;

  /**
   * The size of the array, if this is an array batch job.
   *
   * Valid values are integers between 2 and 10,000.
   *
   * @default no arrayProperties are set
   */
  readonly size?: number;

  /**
   * The number of times to attempt to retry, if the job fails. Valid values are 1–10.
   *
   * @default no retryStrategy is set
   */
  readonly attempts?: number;

  /**
   * The name of the submitted job
   *
   * @default - Automatically generated
   */
  readonly jobName?: string;
}

/**
 * Use an AWS Batch Job / Queue as an event rule target.
 * Most likely the code will look something like this:
 * `new BatchJob(jobQueue.jobQueueArn, jobQueue, jobDefinition.jobDefinitionArn, jobDefinition)`
 *
 * In the future this API will be improved to be fully typed
 */
export class BatchJob implements events.IRuleTarget {
  constructor(
    /**
     * The JobQueue arn
     */
    private readonly jobQueueArn: string,

    /**
     * The JobQueue Resource
     */
    private readonly jobQueueScope: IConstruct,

    /**
     * The jobDefinition arn
     */
    private readonly jobDefinitionArn: string,

    /**
     * The JobQueue Resource
     */
    private readonly jobDefinitionScope: IConstruct,
    private readonly props: BatchJobProps = {},
  ) { }

  /**
   * Returns a RuleTarget that can be used to trigger queue this batch job as a
   * result from an EventBridge event.
   */
  public bind(rule: events.IRule, _id?: string): events.RuleTargetConfig {
    this.validateJobName(rule, this.props.jobName);
    const jobName = this.props.jobName ?? Names.uniqueResourceName(rule, {
      maxLength: 128,
    });
    const batchParameters: events.CfnRule.BatchParametersProperty = {
      jobDefinition: this.jobDefinitionArn,
      jobName,
      arrayProperties: this.props.size ? { size: this.props.size } : undefined,
      retryStrategy: this.props.attempts ? { attempts: this.props.attempts } : undefined,
    };

    if (this.props.deadLetterQueue) {
      addToDeadLetterQueueResourcePolicy(rule, this.props.deadLetterQueue);
    }

    // When scoping resource-level access for job submission, you must provide both job queue and job definition resource types.
    // https://docs.aws.amazon.com/batch/latest/userguide/ExamplePolicies_BATCH.html#iam-example-restrict-job-def
    const role = singletonEventRole(this.jobDefinitionScope);
    role.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ['batch:SubmitJob'],
      resources: [
        this.jobDefinitionArn,
        this.jobQueueArn,
      ],
    }));

    return {
      ...bindBaseTargetConfig(this.props),
      arn: this.jobQueueArn,
      role,
      input: this.props.event,
      targetResource: this.jobQueueScope,
      batchParameters,
    };
  }

  private validateJobName(rule: events.IRule, name?: string) {
    if (!Token.isUnresolved(name) && name !== undefined && (name.length < 1 || name.length > 128)) {
      throw new ValidationError(`Invalid jobName value ${name}, must have length between 1 and 128, got: ${name.length}`, rule);
    }
  }
}
