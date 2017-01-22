var m_ninjas = [
    {
        max_damage: 5,
        stock: 2,
        move: {
            strength: 500,
            max_speed: 15,
            jump: 100
        },
        jetpack: {
            strength:     10,
            max_speed:    15,
            max_ammo:     100,
            reload_rate:  0.32
        },
        body: {
            radius: 1.5,
            density: 1.5,
            friction: 0.1,
            restitution: 0.02
        },
        toss: {
            force_mult: 15
        }
    }
];

if (typeof module !== 'undefined' && module.exports) {
    module.exports = m_ninjas;
}

