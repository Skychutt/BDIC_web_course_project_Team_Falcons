import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoutePlanner} from '../../cinema/static/js/map-route.js';
globalThis.document={createElement:()=>({append(){},textContent:''})};
function fixture(result,status='complete',byMode) {
 const added=[], removed=[];let fit=0;
 class Shape {constructor(options){this.options=options;}}
 const plannerFor=(mode)=>{
  const spec=byMode?.[mode]||{status,result};
  return class {clear(){} search(a,b,done){done(spec.status,spec.result);}};
 };
 const A={Polyline:Shape,Marker:Shape,Walking:plannerFor('walking'),Driving:plannerFor('driving'),plugin:(name,done)=>done()};
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
test('walking and driving routes stay on the map together',async()=>{
 const walk=[[116,39],[116.002,39.001]];
 const drive=[[116,39],[116.004,39.003],[116.006,39.002]];
 const f=fixture(null,'error',{
  walking:{status:'complete',result:{routes:[{distance:900,time:700,steps:[{path:walk,instruction:'Walk straight'}]}]}},
  driving:{status:'complete',result:{routes:[{distance:1400,time:240,steps:[{path:drive,instruction:'Drive ahead'}]}]}},
 });
 const summary=await f.planner.searchModes(walk[0],drive.at(-1),['walking','driving']);
 assert.deepEqual(summary.routes.map(route=>route.mode),['walking','driving']);
 assert.equal(summary.errors.length,0);
 assert.equal(f.added.length,4);
 assert.equal(f.added[0].options.strokeColor,'#e26a00');
 assert.deepEqual(f.added[0].options.path,walk);
 assert.equal(f.added[1].options.strokeColor,'#2168d9');
 assert.deepEqual(f.added[1].options.path,drive);
 assert.equal(f.panel.hidden,false);
 assert.equal(f.fit(),1);
});
test('one available route is still drawn when the other has no road',async()=>{
 const path=[[116,39],[116.002,39.002]];
 const f=fixture(null,'error',{
  walking:{status:'complete',result:{routes:[{distance:500,time:400,steps:[{path,instruction:'Walk'}]}]}},
  driving:{status:'complete',result:{routes:[{steps:[]}]}},
 });
 const summary=await f.planner.searchModes(path[0],path.at(-1),['walking','driving']);
 assert.deepEqual(summary.routes.map(route=>route.mode),['walking']);
 assert.equal(summary.errors[0].code,'route_no_data');
 assert.equal(f.added.length,3);
 assert.equal(f.added[0].options.strokeColor,'#e26a00');
});
test('encoded provider polyline is drawn',async()=>{
 const f=fixture({routes:[{distance:400,time:300,steps:[{polyline:'116.1,39.9;116.2,39.91',instruction:'Continue'}]}]});
 await f.planner.search([116.1,39.9],[116.2,39.91],'walking');
 assert.deepEqual(f.added[0].options.path,[[116.1,39.9],[116.2,39.91]]);
});
test('provider permission failure stays an error',async()=>{
 const f=fixture({info:'INVALID_USER_KEY'},'error');await assert.rejects(f.planner.search([116,39],[117,40]),/route_permission/);assert.equal(f.added.length,0);
});
test('route connection failure is distinct from denied permission',async()=>{
 const f=fixture({info:'MAP_CONNECTION'},'error');await assert.rejects(f.planner.search([116,39],[117,40]),/route_connection/);assert.equal(f.added.length,0);
});
