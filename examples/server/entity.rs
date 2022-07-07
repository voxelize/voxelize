// let test_body = RigidBody::new(&AABB::new(0.0, 0.0, 0.0, 0.5, 0.5, 0.5)).build();

// world
//     .ecs_mut()
//     .create_entity()
//     .with(EntityFlag::default())
//     .with(ETypeComp::new("Box"))
//     .with(IDComp::new(&nanoid!()))
//     .with(PositionComp::new(3.0, 30.0, 3.0))
//     .with(TargetComp::new(0.0, 0.0, 0.0))
//     .with(HeadingComp::new(0.0, 0.0, 0.0))
//     .with(MetadataComp::new())
//     .with(RigidBodyComp::new(&test_body))
//     .with(CurrentChunkComp::default())
//     .with(BoxFlag)
//     .build();

// let mut test = MetadataComp::new();
// test.set("test1", json!(PositionComp::new(-1.0, 80.0, 0.0)));
// test.set("test2", json!("test2"));
// let json_str = test.to_json_string();
// let test2: HashMap<String, serde_json::Value> = serde_json::from_str(&json_str).unwrap();
// let position: PositionComp =
//     serde_json::from_value(test2.get("test1").unwrap().to_owned()).unwrap();

// info!("{:?}", position);
