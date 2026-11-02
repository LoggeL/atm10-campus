export function validPlacement(plan) {
  if (plan.worldOrigin === null) return !plan.rotationDegrees || plan.rotationDegrees === 0;
  return Array.isArray(plan.worldOrigin) && plan.worldOrigin.length === 3 && plan.worldOrigin.every(Number.isSafeInteger)
    && Math.abs(plan.worldOrigin[0]) < 29000000 && Math.abs(plan.worldOrigin[2]) < 29000000 && plan.worldOrigin[1] >= -64 && plan.worldOrigin[1] <= 319
    && [0,90,180,270].includes(plan.rotationDegrees) && plan.site?.status === 'planned';
}
export function worldPoint(plan, p) {
  const [x,y,z]=p, [a,b,c]=plan.worldOrigin;
  const q=plan.rotationDegrees;
  return q===90?[a+z,b+y,c-x]:q===180?[a-x,b+y,c-z]:q===270?[a-z,b+y,c+x]:[a+x,b+y,c+z];
}
