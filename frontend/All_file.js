async function loadMapData() {
  const [nodesRes, doorsRes, walkableRes] = await Promise.all([
    fetch("Floor01/nodes_floor1.json"),
    fetch("Floor01/doors.json"),
    fetch("Floor01/walkable.json")
  ]);

  const [nodes, doors, walkable] = await Promise.all([
    nodesRes.json(),
    doorsRes.json(),
    walkableRes.json()
  ]);

  // รวม nodes และ doors เป็นชุดเดียว
  const allNodes = { ...nodes, ...doors };

  // ข้อมูลรวม
  const mapData = {
    nodes: allNodes,
    walkable: walkable.walkable
  };

  console.log("📌 รวมข้อมูลเรียบร้อย:", mapData);
  return mapData;
}
