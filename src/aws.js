const AWS = require('aws-sdk');
const core = require('@actions/core');
const config = require('./config');
const { info } = require('@actions/core');

// User data scripts are run as the root user
function buildUserDataScript(githubRegistrationToken, label) {
  if (config.input.runnerHomeDir) {
    // If runner home directory is specified, we expect the actions-runner software (and dependencies)
    // to be pre-installed in the AMI, so we simply cd into that directory and then start the runner
    return [
      '#!/bin/bash',
      `cd "${config.input.runnerHomeDir}"`,
      `echo "${config.input.preRunnerScript}" > pre-runner-script.sh`,
      'source pre-runner-script.sh',
      'export RUNNER_ALLOW_RUNASROOT=1',
      `./config.sh --url https://github.com/${config.githubContext.owner}/${config.githubContext.repo} --token ${githubRegistrationToken} --labels ${label}`,
      './run.sh',
    ];
  } else {
    return [
      '#!/bin/bash',
      'mkdir actions-runner && cd actions-runner',
      `echo "${config.input.preRunnerScript}" > pre-runner-script.sh`,
      'source pre-runner-script.sh',
      'case $(uname -m) in aarch64) ARCH="arm64" ;; amd64|x86_64) ARCH="x64" ;; esac && export RUNNER_ARCH=${ARCH}',
      'curl -O -L https://github.com/actions/runner/releases/download/v2.299.1/actions-runner-linux-${RUNNER_ARCH}-2.299.1.tar.gz',
      'tar xzf ./actions-runner-linux-${RUNNER_ARCH}-2.299.1.tar.gz',
      'export RUNNER_ALLOW_RUNASROOT=1',
      `./config.sh --url https://github.com/${config.githubContext.owner}/${config.githubContext.repo} --token ${githubRegistrationToken} --labels ${label}`,
      './run.sh',
    ];
  }
}
function buildMarketOptions() {
  if (config.input.marketType === 'spot') {
    return {
      MarketType: config.input.marketType,
      SpotOptions: {
        SpotInstanceType: 'one-time',
      },
    };
  }

  return undefined;
}


async function startEc2Instance(label, githubRegistrationToken) {
  const ec2 = new AWS.EC2();

  const userData = buildUserDataScript(githubRegistrationToken, label);

  const params = {
    ImageId: config.input.ec2ImageId,
    InstanceType: config.input.ec2InstanceType,
    MinCount: config.input.runnerCount,
    MaxCount: config.input.runnerCount,
    UserData: Buffer.from(userData.join('\n')).toString('base64'),
    SubnetId: config.input.subnetId,
    SecurityGroupIds: [config.input.securityGroupId],
    IamInstanceProfile: { Name: config.input.iamRoleName },
    TagSpecifications: config.tagSpecifications,
    InstanceMarketOptions: buildMarketOptions(),
  };

  try {
    const result = await ec2.runInstances(params).promise();
    const ec2InstanceIds = result.Instances.map(inst => inst.InstanceId);
    core.info(`AWS EC2 instances ${ec2InstanceIds} are started`);
    return ec2InstanceIds;
  } catch (error) {
    core.error('AWS EC2 instance starting error');
    throw error;
  }
}
class ec2InstaceIdWithLabel{
  constructor(label, ec2InstanceId) {
    this.label = label;
    this.ec2InstanceId = ec2InstanceId;
  }

  getLabel() {
    return this.label;
  }

  getEc2InstanceId() {
    return this.ec2InstanceId;
  }
}
async function startEc2withUniqueLabelForEachInstance(maxConfigRunners,githubRegistrationToken){
  const ec2InstacesIds=[];
  const ec2InstaceIdWithLabels=[];
  const labels=[];



  const ec2 = new AWS.EC2();
  core.info(`starting the instances of a total of ${maxConfigRunners}`)
  for (let i = 0; i < maxConfigRunners; i++) {
    const labelForThisInstance= config.generateRandomString(60);
    const userData = buildUserDataScript(githubRegistrationToken, labelForThisInstance);

    const params = {
      ImageId: config.input.ec2ImageId,
      InstanceType: config.input.ec2InstanceType,
      MinCount: 1,
      MaxCount: 1,
      UserData: Buffer.from(userData.join('\n')).toString('base64'),
      SubnetId: config.input.subnetId,
      SecurityGroupIds: [config.input.securityGroupId],
      IamInstanceProfile: { Name: config.input.iamRoleName },
      TagSpecifications: config.tagSpecifications,
      KeyName: config.awsKeyPair,
      InstanceMarketOptions: buildMarketOptions()
    };
    try {
      core.info("AWS EC2 instances are starting");
      const result = await ec2.runInstances(params).promise();
      const ec2InstanceId = result.Instances[0].InstanceId;
      core.info(`AWS EC2 instances ${ec2InstanceId} are started with label ${labelForThisInstance}`);
      ec2InstacesIds.push(ec2InstanceId);
      ec2InstaceIdWithLabels.push(new ec2InstaceIdWithLabel(labelForThisInstance,ec2InstanceId));
      labels.push(labelForThisInstance);

    } catch (error) {
      core.error('AWS EC2 instance starting error');
      throw error;
    }

  }
  return [ec2InstaceIdWithLabels,ec2InstacesIds,labels];
}

async function terminateEc2Instance() {
  const ec2 = new AWS.EC2();

  const params = {
    InstanceIds: config.input.ec2InstanceIds,
  };

  try {
    await ec2.terminateInstances(params).promise();
    core.info(`AWS EC2 instances ${config.input.ec2InstanceIds} are terminated`);
    return;
  } catch (error) {
    core.error(`AWS EC2 instances ${config.input.ec2InstanceIds} termination error`);
    throw error;
  }
}

async function waitForInstanceRunning(ec2InstanceIds) {
  const ec2 = new AWS.EC2();

  const params = {
    InstanceIds: ec2InstanceIds,
  };

  try {
    await ec2.waitFor('instanceRunning', params).promise();
    core.info(`AWS EC2 instances ${ec2InstanceIds} are up and running`);
    return;
  } catch (error) {
    core.error(`AWS EC2 instances ${ec2InstanceIds} initialization error`);
    throw error;
  }
}

module.exports = {
  startEc2Instance,
  terminateEc2Instance,
  waitForInstanceRunning,
  startEc2withUniqueLabelForEachInstance
};
