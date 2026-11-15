export class FixtureServiceError extends Error {
 constructor(message,status,code,data){super(message);this.status=status;this.code=code;this.data=data;this.response={status,data:{error:message,code,...data}};}
}
