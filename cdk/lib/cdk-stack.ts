import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Rule } from 'aws-cdk-lib/aws-events';
import { CloudWatchLogGroup } from 'aws-cdk-lib/aws-events-targets';
import { Metric, Alarm, ComparisonOperator, Unit } from 'aws-cdk-lib/aws-cloudwatch';
import { Role, ServicePrincipal, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import * as ses from 'aws-cdk-lib/aws-ses';
import { CfnEmailIdentity } from "aws-cdk-lib/aws-ses";

export class OverWatchSES extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create Log Group for SES Events
    const logGroup = new LogGroup(this, 'OverWatchSESLogGroup', {
      retention: RetentionDays.ONE_YEAR,
      logGroupName: '/aws/overwatch/ses-logs',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create an IAM Role that SES can assume to publish events to CloudWatch
    const sesCloudWatchRole = new Role(this, 'SESCloudWatchRole', {
      assumedBy: new ServicePrincipal('ses.amazonaws.com'),
    });

    // Grant permission for the role to put events to EventBridge
    sesCloudWatchRole.addToPolicy(new PolicyStatement({
      actions: ['events:PutEvents', 'logs:CreateLogStream', 'logs:PutLogEvents'],
      resources: ['*'],
    }));

    // Create SES Configuration Set
    const configurationSet = new ses.CfnConfigurationSet(this, 'SESConfigurationSet', {
      name: 'OverWatchConfigurationSet',
    });

    // Create an SES email identity and send the verification email
    const emailAddressIdentity = 'lcelli@truemark.io';  // Replace with your verified email or domain

    // Attach the configuration set to the email identity
    const identity = new CfnEmailIdentity(this, 'SESEmailIdentity', {
      emailIdentity: emailAddressIdentity,
      configurationSetAttributes: {
        configurationSetName: configurationSet.name!,
      },
    });

    // Ensure the configuration set is created before it's attached to the email identity
    identity.node.addDependency(configurationSet);

    const eventDestination = new ses.CfnConfigurationSetEventDestination(this, 'SESConfigurationSetEventDestination', {
      configurationSetName: configurationSet.name!,
      eventDestination: {
        matchingEventTypes: [
          ses.EmailSendingEvent.SEND,
          ses.EmailSendingEvent.REJECT,
          ses.EmailSendingEvent.BOUNCE,
          ses.EmailSendingEvent.COMPLAINT,
          ses.EmailSendingEvent.RENDERING_FAILURE
        ],
        eventBridgeDestination: {
           eventBusArn: `arn:aws:events:${this.region}:${this.account}:event-bus/default`,
        },
        enabled: true
      },
    });

    // Ensure the configuration set is created before it's attached to the event destination
    eventDestination.node.addDependency(configurationSet);

    // Create EventBridge Rule to capture SNS notifications and forward to CloudWatch Logs
    const eventRule = new Rule(this, 'OverwatchEventRule', {
      eventPattern: {
        source: ['aws.ses'],
        detailType: ['Email Sent', 'Email Bounced', 'Email Complaint Received', 'Email Rejected', 'Email Rendering Failed'],
      },
    });

    // Add CloudWatch Log Group as the target of the EventBridge Rule
    eventRule.addTarget(new CloudWatchLogGroup(logGroup));

    // Ensure the log group is created before it's added as a dependency
    eventRule.node.addDependency(logGroup, eventDestination);

    // CloudWatch Metrics and Alarms
    const bounceRateMetric = new Metric({
      namespace: 'AWS/SES',
      metricName: 'Reputation.BounceRate',
      statistic: 'Average',
      period: cdk.Duration.minutes(60),
      unit: Unit.PERCENT,
    });

    const complaintRateMetric = new Metric({
      namespace: 'AWS/SES',
      metricName: 'Reputation.ComplaintRate',
      statistic: 'Average',
      period: cdk.Duration.minutes(60),
      unit: Unit.PERCENT,
    });

    const sendingRateMetric = new Metric({
      namespace: 'AWS/SES',
      metricName: 'MaxSendRate',
      statistic: 'Maximum',
      period: cdk.Duration.minutes(5),
      unit: Unit.COUNT,
    });

    new Alarm(this, 'SES - HighBounceRateAlarm', {
      metric: bounceRateMetric,
      threshold: 4,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'Alarm when SES reputation bounce rate is too high',
      treatMissingData: cdk.aws_cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    new Alarm(this, 'SES - HighComplaintRateAlarm', {
      metric: complaintRateMetric,
      threshold: 0.09,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'Alarm when SES reputation complaint rate is too high',
      treatMissingData: cdk.aws_cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    new Alarm(this, 'SES - SendingQuotaUsageAlarm', {
      metric: sendingRateMetric,
      threshold: 0.8,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'Alarm when SES sending rate reaches 80% of the quota',
      treatMissingData: cdk.aws_cloudwatch.TreatMissingData.NOT_BREACHING,
    });
  }
}

const app = new cdk.App();
new OverWatchSES(app, 'OverWatchSES');
