export const manifest = (() => {
function __memo(fn) {
	let value;
	return () => value ??= (value = fn());
}

return {
	appDir: "_app",
	appPath: "_app",
	assets: new Set(["favicon.svg"]),
	mimeTypes: {".svg":"image/svg+xml"},
	_: {
		client: {start:"_app/immutable/entry/start.D0fjpHvp.js",app:"_app/immutable/entry/app.C5lxcvzk.js",imports:["_app/immutable/entry/start.D0fjpHvp.js","_app/immutable/chunks/CmJWyg9Y.js","_app/immutable/chunks/PWCouxKx.js","_app/immutable/entry/app.C5lxcvzk.js","_app/immutable/chunks/CekVB0OK.js","_app/immutable/chunks/PWCouxKx.js","_app/immutable/chunks/DsnmJJEf.js"],stylesheets:[],fonts:[],uses_env_dynamic_public:false},
		nodes: [
			__memo(() => import('./nodes/0.js')),
			__memo(() => import('./nodes/1.js'))
		],
		routes: [
			
		],
		prerendered_routes: new Set(["/"]),
		matchers: async () => {
			
			return {  };
		},
		server_assets: {}
	}
}
})();
