import { EC2Client, RunInstancesCommand, TerminateInstancesCommand } from "@aws-sdk/client-ec2";
import { SQSClient, GetQueueAttributesCommand } from "@aws-sdk/client-sqs";

const ec2Client = new EC2Client();
const sqsClient = new SQSClient();
const sqsRequestQueueUrl = 'https://sqs.us-east-1.amazonaws.com/533266969005/1227953352-req-queue';
const amiId = 'ami-01efa4fdaf7c4cb0e';
const instanceType = 't2.micro';
const keyName = 'asuto-first-key';
const securityGroupId = 'sg-0e20d2b8531391245';

let ec2InstanceList = [];
let currentCount = 0;
const minimumCount = 0;
const maximumCount = 19;
let additionalCheckCountForScaleOut = 0;

async function retrieveTotalNumberOfMessages() {
    const sqsRequestQueueAttributes = await sqsClient.send(new GetQueueAttributesCommand({
        QueueUrl: sqsRequestQueueUrl,
        AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible']
    }));
    const visibleMessages = parseInt(sqsRequestQueueAttributes.Attributes.ApproximateNumberOfMessages);
    const invisibleMessages = parseInt(sqsRequestQueueAttributes.Attributes.ApproximateNumberOfMessagesNotVisible);
    return visibleMessages + invisibleMessages;
}

async function scaleOutEc2Instances(totalMessages) {
    const instancesToScaleOut = Math.min(totalMessages - currentCount, maximumCount);
    for (let i = 0; i < instancesToScaleOut; i++) {
        const params = {
            ImageId: amiId,
            MinCount: 1,
            MaxCount: 1,
            InstanceType: instanceType,
            KeyName: keyName,
            SecurityGroupIds: [securityGroupId],
            TagSpecifications: [
                {
                    ResourceType: 'instance',
                    Tags: [
                        {
                            Key: 'Name',
                            Value: 'app-tier-instance-' + i
                        }
                    ]
                }
            ],
        };
        const data = await ec2Client.send(new RunInstancesCommand(params));
        const instanceId = data.Instances[0].InstanceId;
        ec2InstanceList.push(instanceId);
        currentCount++;
    }
    additionalCheckCountForScaleOut = totalMessages;
}

async function scaleInEc2Instances(totalMessages) {
    for (let i = currentCount; i > totalMessages; i--) {
        await ec2Client.send(new TerminateInstancesCommand({ InstanceIds: [ec2InstanceList.pop()] }));
        currentCount--;
    }
}

export async function start_autoscaling() {
    setInterval(async () => {
        try {
            console.log('Retrieving the number of awaiting messages from the Request Queue every 30 seconds...');
            const totalMessages = await retrieveTotalNumberOfMessages();
            console.log('Total number of messages awaiting in the SQS Request Queue:', totalMessages);
            console.log('Total number of EC2 instances running:', currentCount);

            if (additionalCheckCountForScaleOut < totalMessages) {
                if (totalMessages > currentCount && currentCount < maximumCount) {
                    await scaleOutEc2Instances(totalMessages);
                    console.log("Scaled out EC2 instances successfully.");
                }
            } else if (totalMessages <= currentCount - 1 && currentCount > minimumCount) {
		await scaleInEc2Instances(totalMessages);
                console.log("Scaled in EC2 instances successfully.");
		additionalCheckCountForScaleOut = totalMessages;
            } else if (currentCount < minimumCount) {
                console.log('Starting minimum number of instances because the number of currently running EC2 instances is less than the desired quantity which is 1...');
                const params = {
                    ImageId: amiId,
                    MinCount: 1,
                    MaxCount: 1,
                    InstanceType: instanceType,
                    KeyName: keyName,
                    SecurityGroupIds: [securityGroupId],
                };
                const data = await ec2Client.send(new RunInstancesCommand(params));
                const instanceId = data.Instances[0].InstanceId;
                ec2InstanceList.push(instanceId);
                currentCount++;
                console.log("Started minimum number of instances.");
            } else {
                console.log('No scaling needed.');
            }
        } catch (error) {
            console.error("Exception occurred when running the controller:", error);
        }
    }, 30000); // Run every 30000 milliseconds (30 seconds)
}
