import {randomBytes,randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
const target=process.argv[2];if(!target)throw new Error('Supply a new private output filename outside the repository.');
writeFileSync(target,JSON.stringify([{id:randomUUID(),token:randomBytes(32).toString('base64url')}],null,2)+'\n',{flag:'wx',mode:0o600});
console.log('Private installation grant created. Transfer it through your secret manager; do not commit or share it in chat.');
