// Historical synthetic datasets now answer the independent HTTP contract.
function fixturePath(raw){const path=new URL(raw).pathname;
 if(path==='/api/v1/settings/public')return '/api/public-settings';
 if(path==='/api/v1/auth/me')return '/api/entities/User/me';
 if(path.startsWith('/api/v1/services/'))return path.replace('/api/v1/services/','/api/functions/');
 const match=path.match(/^\/api\/v1\/records\/([^/]+)(?:\/(.*))?$/);
 if(match)return '/api/entities/'+match[1]+'/'+(match[2]==='query'?'v2/list':match[2]??'');
 return path;
}
module.exports={fixturePath};
