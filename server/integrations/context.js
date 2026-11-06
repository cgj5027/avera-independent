const contexts=new WeakMap();
export function bindContext(request,context){contexts.set(request,context);return request;}
export function serviceContext(request){const context=contexts.get(request);if(!context)throw new Error('Unauthenticated service context.');return context;}
