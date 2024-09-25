import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Rule } from 'aws-cdk-lib/aws-events';
import { CloudWatchLogGroup } from 'aws-cdk-lib/aws-events-targets';
import { Metric, Alarm, ComparisonOperator, Unit } from 'aws-cdk-lib/aws-cloudwatch';

export class OverWatchSES extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const logGroup = new LogGroup(this, 'OverWatchSESLogGroup', {
      retention: RetentionDays.ONE_YEAR,
      logGroupName: '/aws/overwatch/ses-logs'
    });

    const sesEventRule = new Rule(this, 'SESEventRule', {
      eventPattern: {
        source: ['aws.ses'],
        detailType: [
          'Email Bounced',
          'Email Complaint Received',
          'Email Delivery Delayed',
          'Email Rejected',
          'Email Rendering Failed'
        ],
      },
    });

    sesEventRule.addTarget(new CloudWatchLogGroup(logGroup));

    const bounceRateMetric = new Metric({
      namespace: 'AWS/SES',
      metricName: 'Reputation.BounceRate',
      statistic: 'Average',
      period: cdk.Duration.minutes(5),
      unit: Unit.PERCENT,
    });

    const complaintRateMetric = new Metric({
      namespace: 'AWS/SES',
      metricName: 'Reputation.ComplaintRate',
      statistic: 'Average', // Using string for statistic as required
      period: cdk.Duration.minutes(5),
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
