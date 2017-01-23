const Box2D    = require('../js/libs/box2d');
const noise    = require('../js/libs/perlin');
const settings = require('../js/game/objects/settings');
const m_crates = require('../js/game/objects/crates');
const m_guns   = require('../js/game/objects/guns');
const m_ninjas = require('../js/game/objects/ninjas');
const server   = require('./server')


var rng_seed = "" + 1000; //Math.floor(Math.random() * 1000000);
console.log("rng_seed: " + rng_seed);

// Array Remove - By John Resig (MIT Licensed)
Array.prototype.remove = function(from, to) {
  var rest = this.slice((to || from) + 1 || this.length);
  this.length = from < 0 ? this.length + from : from;
  return this.push.apply(this, rest);
};

function dist(x1, y1, x2, y2) {
    var dx = x1 - x2;
    var dy = y1 - y2;
    return Math.sqrt(dx * dx + dy * dy);
}

function map(value, istart, istop, ostart, ostop) {
    return ostart + (ostop - ostart) * ((value - istart) / (istop - istart));
}

function sign(x) { return x ? x < 0 ? -1 : 1 : 0; }

var game = {
    world: new Box2D.b2World(new Box2D.b2Vec2(0, -25), false),
    listener: new Box2D.JSContactListener(),
    user_data: {},
    asteroids: {},
    bullets: {},
    crates: {},
    ninjas: {},
    boundary: {},
    spawnpoints: {},
    entity_category: {
        asteroid: 1 << 0,
        ninja:    1 << 1,
        bullet:   1 << 2,
        crate:    1 << 3
    },
    iteration: 0,
    asteroids_created: 0,
    ninja_ais: [],

    send_buffer: [], // stuff to send next step, {id, type}

    KEY_UP   : 1,
    KEY_RIGHT: 2,
    KEY_DOWN : 4,
    KEY_LEFT : 8,
    KEY_TOSS : 16,
    KEY_MENU: 32,

    init: function() {
        // setup collision fun
        this.listener.BeginContact = function(contactPtr) {
            var contact = Box2D.wrapPointer(contactPtr, Box2D.b2Contact);
            var udA = contact.GetFixtureA().GetUserData();
            var udB = contact.GetFixtureB().GetUserData();

            if(udA == 0 || udB == 0) {
                console.log("unknown");
                return;
            }

            var tA = game.user_data[udA].type;
            var tB = game.user_data[udB].type;

            if((tA == 'bullet'   && tB == 'bullet')
            || (tA == 'asteroid' && tB == 'asteroid')
            || (tA == 'crate'    && tB == 'crate')
            || (tA == 'crate'    && tB == 'asteroid')
            || (tA == 'asteroid' && tB == 'crate')) {
                return;
            }

            var bA, bB; //body
            if(tA == 'bullet')   { bA = game.bullets[udA].body; }
            if(tA == 'asteroid') { bA = game.asteroids[udA].body; }
            if(tA == 'crate')    { bA = game.crates[udA].body; }
            if(tA == 'ninja')    { bA = game.ninjas[udA].body; }
            
            if(tB == 'bullet')   { bB = game.bullets[udB].body; }
            if(tB == 'asteroid') { bB = game.asteroids[udB].body; }
            if(tB == 'crate')    { bB = game.crates[udB].body; }
            if(tB == 'ninja')    { bB = game.ninjas[udB].body; }
            

            var pxA = bA.GetPosition().get_x();
            var pyA = bA.GetPosition().get_y();
            var pxB = bB.GetPosition().get_x();
            var pyB = bB.GetPosition().get_y();

            var angleAB = Math.atan2(pyB - pyA, pxB - pxA);
            var angleBA = angleAB + Math.PI;

            var vxA = bA.GetLinearVelocity().get_x();
            var vyA = bA.GetLinearVelocity().get_y();
            var vxB = bB.GetLinearVelocity().get_x();
            var vyB = bB.GetLinearVelocity().get_y();

            var vdx = vxA - vxB;
            var vdy = vyA - vyB;

            var impactForce = Math.abs(vdx) + Math.abs(vdy);

            if(tA == 'ninja' && tB == 'ninja') {
                var ninjaA = game.ninjas[udA];
                var ninjaB = game.ninjas[udB];

                var f = settings.collide.ninja_to_ninja_base + impactForce;
                var dA = ninjaA.damage;
                var dB = ninjaB.damage;

                var impulseA = f * (dA + 1.0) * settings.collide.ninja_to_ninja_mult_f;
                var impulseB = f * (dB + 1.0) * settings.collide.ninja_to_ninja_mult_f;

                bA.ApplyLinearImpulse(new Box2D.b2Vec2(Math.cos(angleAB) * impulseA, Math.sin(angleAB) * impulseA));
                bB.ApplyLinearImpulse(new Box2D.b2Vec2(Math.cos(angleBA) * impulseB, Math.sin(angleBA) * impulseB));

                if(f < settings.collide.ninja_to_ninja_min) {
                    ninjaA.damage += Math.min(settings.collide.ninja_to_ninja_max_d, f * settings.collide.ninja_to_ninja_mult);
                    ninjaB.damage += Math.min(settings.collide.ninja_to_ninja_max_d, f * settings.collide.ninja_to_ninja_mult);
                }
            }


            function bullet_ninja(bullet_ud, ninja_ud, angle) {
                var bullet = game.bullets[bullet_ud];
                var ninja = game.ninjas[ninja_ud];

                var gd = m_guns[bullet.gun_type].damage;
                var f = impactForce * gd * bullet.body.GetMass();
                var d = ninja.damage;

                var impulse = f * (d + 1.0) * settings.collide.ninja_to_bullet_mult_f;

                bA.ApplyLinearImpulse(new Box2D.b2Vec2(Math.cos(angle) * impulse, Math.sin(angle) * impulse));

                ninja.damage += Math.min(settings.collide.ninja_to_bullet_max_d, f * settings.collide.ninja_to_bullet_mult);

                ninja.get_shot(bullet);
            }

            function bullet_asteroid(bullet_ud) {
                var bullet = game.bullets[bullet_ud];
                bullet.alive = false;
            }
            
            function bullet_crate(bullet_ud) {
                var bullet = game.bullets[bullet_ud];
                bullet.alive = false;
            }
            
            function asteroid_ninja(ninja_ud) {
                var ninja = game.ninjas[ninja_ud];

                if(impactForce > settings.collide.ninja_to_asteroid_min) {
                    ninja.damage += impactForce * settings.collide.ninja_to_asteroid_mult;
                }

                ninja.touching_ground = true;
            }
            
            function crate_ninja(crate_ud, ninja_ud, angle) {
                var crate = game.crates[crate_ud];
                var ninja = game.ninjas[ninja_ud];

                var f = impactForce * crate.body.GetMass() * m_crates[crate.type].damage;
                var d = ninja.damage;

                if(f > m_crates[crate.type].min_dforce) {
                    ninja.damage += Math.min(settings.collide.ninja_to_crate_max_d, f * settings.collide.ninja_to_crate_mult)
                    var impulse = f * (d + 1.0) * settings.collide.ninja_to_crate_mult_f;

                    bA.ApplyLinearImpulse(new Box2D.b2Vec2(Math.cos(angle) * impulse, Math.sin(angle) * impulse));
                } else {
                    ninja.pickup_crate(crate);
                }
            }

            if(tA == 'ninja' && tB == 'bullet') {
                bullet_ninja(udB, udA, angleBA);
            }

            if(tA == 'bullet' && tB == 'ninja') {
                bullet_ninja(udA, udB, angleAB);
            }

            if(tA == 'crate' && tB == 'bullet') {
                bullet_crate(udB);
            }

            if(tA == 'bullet' && tB == 'crate') {
                bullet_crate(udA);
            }

            if(tA == 'asteroid' && tB == 'bullet') {
                bullet_asteroid(udB);
            }

            if(tA == 'bullet' && tB == 'asteroid') {
                bullet_asteroid(udA);
            }

            if(tA == 'ninja' && tB == 'asteroid') {
                asteroid_ninja(udA);
            }

            if(tA == 'asteroid' && tB == 'ninja') {
                asteroid_ninja(udB);
            }

            if(tA == 'ninja' && tB == 'crate') {
                crate_ninja(udB, udA, angleBA);
            }

            if(tA == 'crate' && tB == 'ninja') {
                crate_ninja(udA, udB, angleAB);
            }
        };

        this.listener.EndContact = function(contactPtr) {
            var contact = Box2D.wrapPointer(contactPtr, Box2D.b2Contact);
            var udA = contact.GetFixtureA().GetUserData();
            var udB = contact.GetFixtureB().GetUserData();

            if(udA == 0 || udB == 0) {
                console.log("unknown");
                return;
            }

            var tA = game.user_data[udA].type;
            var tB = game.user_data[udB].type;

            if((tA == 'bullet'   && tB == 'bullet')
            || (tA == 'asteroid' && tB == 'asteroid')
            || (tA == 'crate'    && tB == 'crate')
            || (tA == 'crate'    && tB == 'asteroid')
            || (tA == 'asteroid' && tB == 'crate')) {
                return;
            }

            var bA, bB; //body
            if(tA == 'bullet')   { bA = game.bullets[udA].body; }
            if(tA == 'asteroid') { bA = game.asteroids[udA].body; }
            if(tA == 'crate')    { bA = game.crates[udA].body; }
            if(tA == 'ninja')    { bA = game.ninjas[udA].body; }
            
            if(tB == 'bullet')   { bB = game.bullets[udB].body; }
            if(tB == 'asteroid') { bB = game.asteroids[udB].body; }
            if(tB == 'crate')    { bB = game.crates[udB].body; }
            if(tB == 'ninja')    { bB = game.ninjas[udB].body; }
            


            function asteroid_ninja(ninja_ud) {
                var ninja = game.ninjas[ninja_ud];
                ninja.touching_ground = false;
            }

            if(tA == 'ninja' && tB == 'asteroid') {
                asteroid_ninja(udA);
            }

            if(tA == 'asteroid' && tB == 'ninja') {
                asteroid_ninja(udB);
            }

        };

        // Empty implementations for unused methods.
        this.listener.PreSolve   = function() {};
        this.listener.PostSolve  = function() {};

        this.world.SetContactListener(this.listener);

        var bounds = { left: 0, right: 0, top: 0, bottom: 0 };

        for(var i=0; i<settings.map.asteroids; i++) {
            var x = settings.map.place_x_offset + (i*settings.map.place_x_mult) + (Math.random() * settings.map.place_x_rand);
            var y = settings.map.place_y_offset + (i*settings.map.place_y_mult) + (Math.random() * settings.map.place_y_rand);

            if (x < bounds.left)   { bounds.left   = x; }
            if (x > bounds.right)  { bounds.right  = x; }
            if (y > bounds.top)    { bounds.top    = y; }
            if (y < bounds.bottom) { bounds.bottom = y; }

            this.create_asteroid(x, y);
        }

        for(var i in game.asteroids) {
            var sp_x = game.asteroids[i].body.GetPosition().get_x();
            var sp_y = game.asteroids[i].body.GetPosition().get_y() + 15;

            game.attempt_to_add_spawn_point(sp_x, sp_y);
        }

        for(var i in game.spawnpoints) {
            var s = game.spawnpoints[i];
            this.create_crate(s.x, s.y, 0, 0, Math.random() < 0.5 ? 0 : 1);
        }

        game.boundary = {
            left:   bounds.left   - settings.boundary.left,
            right:  bounds.right  + settings.boundary.right,
            bottom: bounds.bottom - settings.boundary.bottom,
            top:    bounds.top    + settings.boundary.top,
        };
        
        // load bots
        for(var i=0; i<settings.bots.amount; ++i) {
            var id = game.create_ninja();
            var s = game.random_spawn_point();
            game.ninjas[id].spawn(s.x, s.y);
            game.ninja_ais.push(game.ninja_ai_controller(game.ninjas[id]));
        }
    },

    add_user_data: function(data) {
        var id = Math.floor(Math.random() * Math.pow(2, 31));
        game.user_data[id] = data;
        return id;
    },

    attempt_to_add_spawn_point: function(x, y) {
        var r = settings.spawnpoint.radius;

        var cool = true;

        for(var j in game.asteroids) {
            var aj = game.asteroids[j];

            var jx = aj.body.GetPosition().get_x();
            var jy = aj.body.GetPosition().get_y();;

            if(jx + aj.width > x - r && jx - aj.width < x + r && jy + aj.height > y - r && jy - aj.height < y + r) {
                cool = false;
                break;
            }
        }

        if(cool) {
            this.create_spawnpoint(x, y);
        }
    },

    random_spawn_point: function() {
        var keys = Object.keys(game.spawnpoints)
        return game.spawnpoints[keys[ keys.length * Math.random() << 0]];
    },

    body_distance(a, b) {
        return dist(a.GetPosition().get_x(), a.GetPosition().get_y(), b.GetPosition().get_x(), b.GetPosition().get_y());
    },

    create_spawnpoint: function(x, y) {
        var id = game.add_user_data({ type: 'spawnpoint' });

        game.spawnpoints[id] = {
            id: id,
            x:  x,
            y:  y
        };
        
        return id;
    },

    create_bullet: function(x, y, px, py, gun_type) {
        var id = game.add_user_data({ type: 'bullet', gun_type: gun_type });
        var radius = m_guns[gun_type].radius;

        var bd = new Box2D.b2BodyDef();
        bd.set_type(Box2D.b2_dynamicBody);
        bd.set_position( new Box2D.b2Vec2(x, y) );

        var circleShape = new Box2D.b2CircleShape();
        circleShape.set_m_radius(radius);

        var filter = new Box2D.b2Filter();
        filter.set_categoryBits(game.entity_category.bullet);
        filter.set_maskBits(game.entity_category.ninja | game.entity_category.crate | game.entity_category.asteroid);

        var fd = new Box2D.b2FixtureDef();
        fd.set_shape(circleShape);
        fd.set_density(m_guns[gun_type].density);
        fd.set_friction(m_guns[gun_type].friction);
        fd.set_restitution(m_guns[gun_type].restitution);
        fd.set_userData(id);
        fd.set_filter(filter);

        var body = this.world.CreateBody(bd);
        body.CreateFixture(fd);
        body.SetLinearVelocity(new Box2D.b2Vec2(px, py));

        var that = this;

        game.bullets[id] = {
            id:       id,
            body:     body,
            radius:   radius,
            lifetime: m_guns[gun_type].lifetime,
            gun_type: gun_type,
            alive: true,

            update: function() {
                if(! this.alive) {
                    return;
                }

                this.alive = --this.lifetime > 0;
            }
        };

        game.send_buffer.push({"type": "bullet_created", "id": id});
    },

    create_ninja: function() {
        var id = game.add_user_data({ type: 'ninja' });
        var ninja_type = 0;

        game.ninjas[id] = {
            id: id,
            body: null,
            alive: true,
            ninja_type: ninja_type,
            stock: m_ninjas[ninja_type].stock,
            deaths: 0,
            facing_dir: -1,
            gun_angle: 0.0,
            touching_ground: false,
            respawn_counter: 0,

            input: {
                update_iteration: 0,
                mouse_down:       [0, 0, 0],
                key_result:       0,
                mouse_angle:      0,
            },
            
            animation: {

            },
            name: ((Math.random() < 0.5) ? "Dan" : "Jett"),

            spawn: function(x, y) {
                var bd = new Box2D.b2BodyDef();
                bd.set_type(Box2D.b2_dynamicBody);
                bd.set_position(new Box2D.b2Vec2(x, y));
                bd.set_fixedRotation(true);
                bd.set_bullet(true);

                var circleShape = new Box2D.b2CircleShape();
                circleShape.set_m_radius(m_ninjas[this.ninja_type].body.radius);

                var filter = new Box2D.b2Filter();
                filter.set_categoryBits(game.entity_category.ninja);
                filter.set_maskBits(game.entity_category.bullet | game.entity_category.ninja | game.entity_category.asteroid | game.entity_category.crate);

                var fd = new Box2D.b2FixtureDef();
                fd.set_shape(circleShape);
                fd.set_density(m_ninjas[this.ninja_type].body.density);
                fd.set_friction(m_ninjas[this.ninja_type].body.friction);
                fd.set_restitution(m_ninjas[this.ninja_type].body.restitution);
                fd.set_userData(id);
                fd.set_filter(filter);

                if(this.body != null) {
                    game.world.DestroyBody(this.body);
                }
                this.body = game.world.CreateBody(bd);
                this.body.CreateFixture(fd);

                this.alive = true;
                this.damage = 0;

                var gun_type = Math.floor(Math.random() * m_guns.length);
                this.gun = {
                    type: gun_type,
                    ammo:         m_guns[gun_type].ammo,
                    fireinterval: m_guns[gun_type].fireinterval,
                    reloadtime:   0
                };

                this.jetpack = {
                    ammo: m_ninjas[this.ninja_type].jetpack.max_ammo
                };
            },

            update: function() {
                if(this.input.mouse_down[0] ) {
                    this.shoot(this.input.mouse_angle);
                }

                if(this.input.mouse_down[2]) {
                   this.fire_jetpack(); 
                }
                switch(this.input.key_result) {
                    case game.KEY_UP:
                        this.jump();
                        break;
                    case game.KEY_LEFT:
                        this.move(-1);
                        break;
                    case game.KEY_RIGHT:
                        this.move(1);
                        break;
                    case game.KEY_UP|game.KEY_LEFT:
                        this.jump();
                        this.move(-1);
                        break;
                    case game.KEY_UP|game.KEY_RIGHT:
                        this.jump();
                        this.move(1);
                        break;
                }
                
                if(this.input.key_result) {
                    this.toss_counter++;
                } else if(this.toss_counter > 0) {
                    var toss_force = Math.min(this.toss_counter, 60) / 60.0;
                    this.toss(toss_force, this.input.mouse_angle);
                    this.toss_counter = 0;
                }

                this.input.key_result = 0;


                if(! this.alive) {
                    if(this.respawn_counter > 0) {
                        this.respawn_counter--;
                        // if(this.respawn_counter == 0 && this.stock > 0) {
                        if(this.respawn_counter == 0){
                            if(settings.victoryCondition.stock && this.stock < 1){
                                console.log("Figure out how to delete the character");
                                this.respawn_counter = 10000;
                            }else{
                                var s = game.random_spawn_point();
                                this.spawn(s.x, s.y); 
                            }
                        }
                    }

                    return;
                }

                this.damage = Math.min(this.damage, m_ninjas[this.ninja_type].max_damage);

                if(this.gun.fireinterval > 0) {
                    this.gun.fireinterval--;
                }

                if(this.gun.reloadtime > 0) {
                    this.gun.reloadtime--;
                }

                if(this.jetpack.ammo < m_ninjas[this.ninja_type].jetpack.max_ammo) {
                    this.jetpack.ammo += m_ninjas[this.ninja_type].jetpack.reload_rate;
                }
            },

            move: function(dir) {
                if(! this.alive) {
                    return;
                }

                if(Math.abs(this.body.GetLinearVelocity().get_x()) < m_ninjas[this.ninja_type].move.max_speed || sign(dir) != sign(this.body.GetLinearVelocity().get_x())) {
                    this.body.ApplyForceToCenter(new Box2D.b2Vec2(m_ninjas[this.ninja_type].move.strength * dir, 0.0));
                }
            },

            shoot: function(angle) {
                if(! this.alive) {
                    return;
                }

                if(this.gun.fireinterval != 0 || this.gun.reloadtime != 0) {
                    return;
                }

                if(this.gun.ammo == 0) {
                    this.gun.ammo = m_guns[this.gun.type].ammo;
                    this.gun.reloadtime = m_guns[this.gun.type].reloadtime;
                    return;
                }

                var strength = m_guns[this.gun.type].strength;
                angle += m_guns[this.gun.type].accuracy * noise.simplex2(game.iteration, 0);

                if(isNaN(this.body.GetPosition().get_x())) {
                    console.log("cb x nan");
                }
                if(isNaN(angle)) {
                    console.log("cb angle nan");
                }

                game.create_bullet(
                    this.body.GetPosition().get_x() + (Math.cos(angle) * m_ninjas[this.ninja_type].body.radius * 2),
                    this.body.GetPosition().get_y() + (Math.sin(angle) * m_ninjas[this.ninja_type].body.radius * 2),
                    this.body.GetLinearVelocity().get_x() + (Math.cos(angle) * strength),
                    this.body.GetLinearVelocity().get_y() + (Math.sin(angle) * strength),
                    this.gun.type
                );

                var bink_strength = m_guns[this.gun.type].selfbink;
                var bink_angle = angle+Math.PI;
                this.body.ApplyLinearImpulse(new Box2D.b2Vec2(Math.cos(bink_angle) * bink_strength, Math.sin(bink_angle) * bink_strength));


                this.gun.fireinterval = m_guns[this.gun.type].fireinterval;
                this.gun.ammo--;

                if(this.gun.ammo == 0) {
                    this.gun.ammo = m_guns[this.gun.type].ammo;
                    this.gun.reloadtime = m_guns[this.gun.type].reloadtime;
                    return;
                }
            },

            jump: function() {
                if(! this.alive) {
                    return;
                }

                //todo fix contact detect
                //maybe just need to loop thru clist?
                var strength = m_ninjas[this.ninja_type].move.jump;
                if(this.touching_ground) {
                    this.body.ApplyLinearImpulse(new Box2D.b2Vec2(0.0, strength));
                    this.body.SetAngularVelocity(0.0);
                }
            },

            fire_jetpack: function() {
                if(! this.alive) {
                    return;
                }

                if(this.jetpack.ammo < 0) {
                    return;
                }

                if(this.body.GetLinearVelocity().get_y() < m_ninjas[this.ninja_type].jetpack.max_speed) {
                    this.body.ApplyLinearImpulse(new Box2D.b2Vec2(0.0, m_ninjas[this.ninja_type].jetpack.strength));
                }

                this.jetpack.ammo--;
            },

            pickup_crate: function(crate) {
                if(! this.alive) {
                    return;
                }

                if(! crate.alive) {
                    return;
                }

                // health pack
                if(crate.type == 0) {
                    this.damage = Math.max(0, this.damage - settings.crates.health_restore);
                }
                if(crate.type == 1) {
                    this.jetpack.ammo += settings.crates.jet_fuel;
                }

                crate.alive = false;
                game.send_buffer.push({"type": "crate_picked_up", "id": this.id});
                console.log("pickup_crate: " + this.id);
            },

            toss: function(f, angle) {
                if(! this.alive) {
                    return;
                }

                //console.log("toss: " + f + " : " + angle);
                var x = this.body.GetPosition().get_x();
                var y = this.body.GetPosition().get_y();
                var force = m_ninjas[this.ninja_type].toss.force_mult * f;
                var crate_type = 1;
                game.create_crate(x + (Math.cos(angle) * ((m_ninjas[this.ninja_type].body.radius * 2) + m_crates[crate_type].width)),
                    y + (Math.sin(angle) * ((m_ninjas[this.ninja_type].body.radius * 2)+ m_crates[crate_type].height)),
                    this.body.GetLinearVelocity().get_x() + (Math.cos(angle) * force),
                    this.body.GetLinearVelocity().get_y() + (Math.sin(angle) * force),
                    crate_type
                );
            },

            get_shot: function(bullet) {
                bullet.alive = false;
            },

            set_gun: function(gun_type) {
                if(! this.alive) {
                    return;
                }

                this.gun = {
                    type: gun_type,
                    ammo:         guns[gun_type].ammo,
                    fireinterval: guns[gun_type].fireinterval,
                    reloadtime:   0
                };
            }
        };

        return id;
    },

    ninja_ai_controller: function(ninja) {
        return {
            n: ninja,
            home: {
                x: ninja.body.GetPosition().get_x(),
                y: ninja.body.GetPosition().get_y()
            },
            target: null,
            update: function() {
                if(this.target == null ||
                    (
                        settings.bots.target == "random" && (
                            !  this.target.alive
                            ||  Math.random() < 1.0 / (settings.bots.target_switch_nsec * 60)
                            || game.body_distance(this.n.body, this.target.body) > settings.bots.max_follow_d
                        )
                    )
                ) {
                    var tries = 0;
                    do {
                        var keys = Object.keys(game.ninjas)
                        this.target = game.ninjas[keys[ keys.length * Math.random() << 0]];
                    } while(! this.target.alive && tries < 5);
                }

                if(settings.bots.target == "you" && game.ninja != null) {
                    this.target = game.ninja.n;
                }

                this.n.facing_dir = this.n.body.GetPosition().get_x() <  ((this.home.x + this.target.body.GetPosition().get_x()) / 2) ? 1 : -1;
                this.n.move(this.n.facing_dir);
                var y_cmp = ((this.home.y + this.target.body.GetPosition().get_y()) / 2) - 10;
                if(this.n.body.GetPosition().get_y() < y_cmp) {
                    this.n.fire_jetpack();
                }

                if(Math.random() < 1.0 / (settings.bots.jump_nsec * 60)) {
                    this.n.jump();
                }

                var angle = Math.atan2(
                    this.target.body.GetPosition().get_y() -this.n.body.GetPosition().get_y(),
                    this.target.body.GetPosition().get_x() -this.n.body.GetPosition().get_x()
                );

                this.n.shoot(angle);
            }
        };
    },

    create_asteroid: function(x, y) {
        var id = game.add_user_data({ type: 'asteroid' });
        this.asteroids_created++;
        var size = 3.5 + (Math.random() * 2.5);
        var edges = 15 + (Math.floor(Math.random()*10));
        var xtoy = 0.25 + (Math.random() * 1.5);
        var ytox = 0.25 + (Math.random() * 1.5);
        var width = 0;
        var height = 0;

        var verts = [];
        for(var i=0; i<edges; i++) {
            var a = Math.PI * 2 / edges * i;
            var ax = Math.cos(a);
            var ay = Math.sin(a);

            var nx = 0.5 + Math.abs(noise.simplex2(ax / 1.613 + (x / 13.2) + (y / 82.45), ay / 1.73  + (x / 13.2) + (y / 82.45)));
            var ny = 0.5 + Math.abs(noise.simplex2(ay / 1.613 + (y / 13.2) + (x / 82.45), ax / 1.73  + (y / 13.2) + (x / 82.45)));

            var mx = xtoy * (ax * (size / 2 + nx) * size / 2);
            var my = ytox * (ay * (size / 2 + ny) * size / 2);

            if(Math.abs(mx) > width) {
                width = Math.abs(mx);
            }

            if(Math.abs(my) > height) {
                height = Math.abs(my);
            }

            verts.push(new Box2D.b2Vec2(mx, my));
        }

        var bd = new Box2D.b2BodyDef();
        bd.set_type(Box2D.b2_staticBody);
        bd.set_position( new Box2D.b2Vec2(x, y) );

        var body = this.world.CreateBody(bd);


        for(var i=0; i<verts.length; i++) {
            var vertices = [ 
                new Box2D.b2Vec2( 0.0, 0.0 ), 
                verts[i], 
                verts[(i+1) % verts.length] 
            ];

            var polygonShape = new Box2D.b2PolygonShape();                
            var buffer = Box2D.allocate(vertices.length * 8, 'float', Box2D.ALLOC_STACK);
            var offset = 0;


            Box2D.setValue(buffer+(0),    vertices[0].get_x(), 'float');
            Box2D.setValue(buffer+(0+4),  vertices[0].get_y(), 'float');
            Box2D.setValue(buffer+(8),    vertices[1].get_x(), 'float');
            Box2D.setValue(buffer+(8+4),  vertices[1].get_y(), 'float');
            Box2D.setValue(buffer+(16),   vertices[2].get_x(), 'float');
            Box2D.setValue(buffer+(16+4), vertices[2].get_y(), 'float');      
            
            var ptr_wrapped = Box2D.wrapPointer(buffer, Box2D.b2Vec2);
            polygonShape.Set(ptr_wrapped, vertices.length);

            var filter = new Box2D.b2Filter();
            filter.set_categoryBits(game.entity_category.asteroid);
            filter.set_maskBits(game.entity_category.bullet | game.entity_category.ninja | game.entity_category.crate);

            var fd = new Box2D.b2FixtureDef();
            fd.set_shape(polygonShape);
            fd.set_density(1.0);
            fd.set_friction(1.0);
            fd.set_restitution(0.1);
            fd.set_userData(id);
            fd.set_filter(filter);
            
            body.CreateFixture(fd);
        }

        game.asteroids[id] = {
            id:     id,
            body:   body,
            verts:  verts,
            height: height,
            width:  width,
            alive:  true,
            size:   size,
            edges:  edges,
            xtoy:   xtoy,
            ytox:   ytox,
        };

        return id;
    },

    create_crate: function(x, y, px, py, crate_type) {
        var id = game.add_user_data({ type: 'crate', crate_type: crate_type });
        var width  = m_crates[crate_type].width;
        var height = m_crates[crate_type].height;

        var bd = new Box2D.b2BodyDef();
        bd.set_type(Box2D.b2_dynamicBody);
        bd.set_position( new Box2D.b2Vec2(x, y) );

        var shape = new Box2D.b2PolygonShape();
        shape.SetAsBox(width, height);

        var filter = new Box2D.b2Filter();
        filter.set_categoryBits(game.entity_category.crate);
        filter.set_maskBits(game.entity_category.ninja | game.entity_category.crate | game.entity_category.asteroid | game.entity_category.bullet);

        var fd = new Box2D.b2FixtureDef();
        fd.set_shape(shape);
        fd.set_density(m_crates[crate_type].density);
        fd.set_friction(m_crates[crate_type].friction);
        fd.set_restitution(m_crates[crate_type].restitution);
        fd.set_userData(id);
        fd.set_filter(filter);

        var body = this.world.CreateBody(bd);
        body.CreateFixture(fd);
        body.SetLinearVelocity(new Box2D.b2Vec2(px, py));

        var that = this;

        game.crates[id] = {
            id:    id,
            body:  body,
            type:  crate_type,
            alive: true,

            update: function() {
                var pos = this.body.GetPosition();
            }
        };

        return id;
    },

    step: function() {
        this.world.Step(1 / 60, 10, 10);
        this.iteration++;

        for(var i in this.bullets) {
            var m = this.bullets[i];
            m.update();

            if(! m.alive) {
                this.world.DestroyBody(m.body);
                delete this.bullets[i];
            }
        }

        for(var i in this.crates) {
            var m = this.crates[i];
            m.update();

            if(! this.bounds_check(m.body)) {
                m.alive = false;
            }

            if(! m.alive) {
                this.world.DestroyBody(m.body);
                delete this.crates[i];
            }
        }

        for(var i in this.ninjas) {
            var m = this.ninjas[i];
            m.update();

            if(! this.bounds_check(m.body)) {
                m.alive = false;
            }
        }


        var lastManVictoryCheck = 0; 
        var stockVictoryCheck = 1;
        var guyCount = 0;
        for(var i in this.ninjas) {
            guyCount++;
            var m = this.ninjas[i];
            m.update();

            // I was trying to get this damage watcher integrated into bounds_check, but I couldnt figure out how to use the object properly
            if((! this.bounds_check(m.body)) || (m.damage >= m_ninjas[m.ninja_type].max_damage)) m.alive = false;
            

            
            if(! m.alive && m.respawn_counter == 0) {
                var delayMod = 1;
                
                if (settings.victoryCondition.lastMan){
                    m.deaths++;
                    console.log("ninja death: " + m.deaths);
                    delayMod = m.deaths * (m.deaths / 2);
                }
                
                
                if (settings.victoryCondition.stock){
                    m.stock--;
                    console.log("stock: " + m.stock);
                }
                m.respawn_counter = settings.spawnpoint.ninja_delay * delayMod;
            }
            // && (this.ninjas.length > 1))
            if (settings.victoryCondition.stock &&  m.stock > 1){
                stockVictoryCheck++;
            }
            if (settings.victoryCondition.lastMan && m.alive){
                lastManVictoryCheck++;
            }
        }
        if (settings.victoryCondition.lastMan && (lastManVictoryCheck <= 1) && (guyCount > 1)){
            console.log("LAST MAN VICTORY MET! RESTARTING!");
            this.victory();
        }
        if ((settings.victoryCondition.stock) && (stockVictoryCheck <= 1) && (guyCount > 1)){
            console.log("STOCK VICTORY MET! RESTARTING!");
            this.victory();
        }

        if(this.ninja != null) {
            this.ninja.update();
        }

        for(var i=0; i<this.ninja_ais.length; ++i) {
            this.ninja_ais[i].update();
        }
    },
    victory: function(){
        console.log('victory');
        // wipe game
        // re-initialize game
        // game.init();
    },
    bounds_check: function(body) {
        if(body.GetPosition().get_x() < game.boundary.left)    return false;
        if(body.GetPosition().get_x() > game.boundary.right)   return false;
        if(body.GetPosition().get_y() > game.boundary.top)     return false;
        if(body.GetPosition().get_y() < game.boundary.bottom)  return false;
        return true;
    },
};

module.exports = game;
