import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoutePlanner} from '../../cinema/static/js/map-route.js';
globalThis.document={createElement:()=>({append(){},textContent:''})};
function fixture(result,status='complete') {
 const added=[], removed=[];let fit=0;
 class Shape {constructor(options){this.options=options;}}
 class Planner {clear(){} search(a,b,done){done(status,result);}}
 const A={Polyline:Shape,Marker:Shape,Walking:Planner,Driving:Planner,plugin:(name,done)=>done()};
 const map={add:v=>added.push(...v),remove:v=>removed.push(...v),setFitView:()=>fit++};
 const panel={hidden:true,replaceChildren(){}};
 return {planner:createRoutePlanner(A,map,panel),added,removed,panel,fit:()=>fit};
}
for (const mode of ['walking','driving']) test(`${mode} draws provider road geometry and directions`,async()=>{
 const path=[[116,39],[116.001,39.002],[116.003,39.004]];
 const f=fixture({routes:[{distance:800,time:600,steps:[{path,instruction:'Turn right'}]}]});
 await f.planner.search(path[0],path.at(-1),mode);
 assert.deepEqual(f.added[0].options.path,path);assert.equal(f.added.length,3);assert.equal(f.panel.hidden,false);assert.equal(f.fit(),1);
 f.planner.clear();assert.equal(f.removed.length,3);assert.equal(f.panel.hidden,true);
});
test('missing road geometry never becomes a fake straight line',async()=>{
 const f=fixture({routes:[{steps:[]}]});await assert.rejects(f.planner.search([116,39],[117,40]),/route_no_data/);assert.equal(f.added.length,0);
});
test('provider permission failure stays an error',async()=>{
 const f=fixture({info:'INVALID_USER_KEY'},'error');await assert.rejects(f.planner.search([116,39],[117,40]),/route_permission/);assert.equal(f.added.length,0);
});
