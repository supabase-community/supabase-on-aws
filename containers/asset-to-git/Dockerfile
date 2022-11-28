FROM --platform=amd64 public.ecr.aws/lambda/provided:al2

RUN yum update -y && \
    yum install jq git tar python3 -y && \
    yum clean all && \
    pip3 install git-remote-codecommit

COPY bootstrap ${LAMBDA_RUNTIME_DIR}
COPY function.sh ${LAMBDA_TASK_ROOT}

RUN chmod 755 ${LAMBDA_RUNTIME_DIR}/bootstrap ${LAMBDA_TASK_ROOT}/function.sh

CMD [ "function.handler" ]
