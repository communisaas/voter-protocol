// Pre-computed Poseidon constants for BN256 scalar field
// Generated at compile time to avoid runtime overhead
//
// PERFORMANCE: Using these static constants eliminates ~50-200ms of runtime
// constant generation per circuit configuration.
//
// Generation: These constants were generated once using the PSE poseidon library's
// generate_constants::<Fr, P128Pow5T3Bn256, WIDTH, RATE>() function and hardcoded here.
//
// Parameters:
// - WIDTH = 3 (state size)
// - RATE = 2 (absorption rate)
// - R_F = 8 (full rounds)
// - R_P = 56 (partial rounds)
// - Total rounds: 64

use halo2curves::bn256::Fr;
use halo2_poseidon::poseidon::primitives::Mds;

/// Pre-computed round constants for all 64 Poseidon rounds
/// Each round has 3 constants (one per state element)
pub fn round_constants() -> Vec<[Fr; 3]> {
    vec![
        // Round 0
        [
            Fr::from_raw([0x59a09a1a97052816, 0x7f8fcde48bb4c37a, 0x8bddd3a93f7804ef, 0x1d066a255517b7fd]),
            Fr::from_raw([0xb7238547d32c1610, 0xb7c6fef31367b68e, 0xac3f089cebcc6120, 0x29daefb55f6f2dc6]),
            Fr::from_raw([0x9e8b7ad7b0b4e1d1, 0x2572d76f08ec5c4f, 0x1ecbd88ad959d701, 0x1f2cb1624a78ee00]),
        ],
        // Round 1
        [
            Fr::from_raw([0xdb0672ded84f31e5, 0xb11f092a53bbc6e1, 0xbd77c0ed3d14aa27, 0x0aad2e79f15735f2]),
            Fr::from_raw([0x091ccf1595b43f28, 0x37028a98f1dece66, 0xd6f661dd4094375f, 0x2252624f8617738c]),
            Fr::from_raw([0xd49f4f2c9018d735, 0x91c20626524b2b87, 0x5a65a84a291da1ff, 0x1a24913a928b3848]),
        ],
        // Round 2
        [
            Fr::from_raw([0x4fd6dae1508fc47a, 0x0a41515ddff497b1, 0x7bfc427b5f11ebb1, 0x22fc468f1759b74d]),
            Fr::from_raw([0xefd65515617f6e4d, 0xe61956ff0b4121d5, 0x9cd026e9c9ca107a, 0x1059ca787f1f89ed]),
            Fr::from_raw([0xa45cbbfae8b981ce, 0x2123011f0bf6f155, 0xf61f3536d877de98, 0x02be9473358461d8]),
        ],
        // Round 3
        [
            Fr::from_raw([0xa1ff3a441a5084a4, 0xaba9b669ac5b8736, 0x2778a749c82ed623, 0x0ec96c8e32962d46]),
            Fr::from_raw([0x48fb2e4d814df57e, 0x5a47a7cdb8c99f96, 0x5442d9553c45fa3f, 0x292f906e07367740]),
            Fr::from_raw([0x0c63f0b2ffe5657e, 0xcc611160a394ea46, 0x26c11b9a0f5e39a5, 0x274982444157b867]),
        ],
        // Round 4
        [
            Fr::from_raw([0x499573f23597d4b5, 0xcedd192f47308731, 0xb63e1855bff015b8, 0x1a1d063e54b1e764]),
            Fr::from_raw([0xb91b002c5b257c37, 0x08235dccc1aa3793, 0x839d109562590637, 0x26abc66f3fdf8e68]),
            Fr::from_raw([0x0b3c2b12ff4d7be8, 0x0754427aabca92a7, 0x81a578cfed5aed37, 0x0c7c64a9d8873853]),
        ],
        // Round 5
        [
            Fr::from_raw([0xedd383831354b495, 0xba2ebac30dc386b0, 0x9e17f0b6d08b2d1e, 0x1cf5998769e9fab7]),
            Fr::from_raw([0x7aba0b97e66b0109, 0x19828764a9669bc1, 0x564ca60461e9e08b, 0x0f5e3a8566be31b7]),
            Fr::from_raw([0x42bf3d7a531c976e, 0xf359a53a180b7d4b, 0x95e60e4db0794a01, 0x18df6a9d19ea90d8]),
        ],
        // Round 6
        [
            Fr::from_raw([0x4e324055fa3123dc, 0xd0ea1d3a3b9d25ef, 0x6e4b782c3c6e601a, 0x04f7bf2c5c0538ac]),
            Fr::from_raw([0xe55d54628b89ebe6, 0xe770c0584aa2328c, 0x3c40058523748531, 0x29c76ce22255206e]),
            Fr::from_raw([0x00e0e945dbc5ff15, 0x65b1b8e9c6108dbe, 0xc053659ab4347f5d, 0x198d425a45b78e85]),
        ],
        // Round 7
        [
            Fr::from_raw([0x49d3a9a90c3fdf74, 0xa7ff7f6878b3c49d, 0x6af3cc79c598a1da, 0x25ee27ab6296cd5e]),
            Fr::from_raw([0xc0f88687a96d1381, 0x05845d7d0c55b1b2, 0x24561001c0b6eb15, 0x138ea8e0af41a1e0]),
            Fr::from_raw([0x4013370a01d95687, 0x42851b5b9811f2ca, 0xf6e7c2cba2eefd0e, 0x306197fb3fab671e]),
        ],
        // Round 8
        [
            Fr::from_raw([0x86419eaf00e8f620, 0x21db7565e5b42504, 0x2b66f0b4894d4f1a, 0x1a0c7d52dc32a443]),
            Fr::from_raw([0xaa52997da2c54a9f, 0xebfbe5f55163cd6c, 0x3ff86a8e5c8bdfcc, 0x2b46b418de80915f]),
            Fr::from_raw([0xfb46e312b5829f64, 0x613a1af5db48e05b, 0x01f8b777b9673af9, 0x12d3e0dc00858737]),
        ],
        // Round 9
        [
            Fr::from_raw([0xba338a5cb19b3a1f, 0xfb2bf768230f648d, 0x70f5002ed21d089f, 0x263390cf74dc3a88]),
            Fr::from_raw([0x7d543db52b003dcd, 0xf8abb5af40f96f1d, 0x0ac884b4ca607ad0, 0x0a14f33a5fe668a6]),
            Fr::from_raw([0xd847df829bc683b9, 0x27be3a4f01171a1d, 0x1a5e86509d68b2da, 0x28ead9c586513eab]),
        ],
        // Round 10
        [
            Fr::from_raw([0xea16cda6e1a7416c, 0x888f0ea1abe71cff, 0x0972031f1bdb2ac9, 0x1c6ab1c328c3c643]),
            Fr::from_raw([0x32346015c5b42c94, 0x4f6decd608cb98a9, 0x2b2500239f7f8de0, 0x1fc7e71bc0b81979]),
            Fr::from_raw([0xe6dd85b93a0ddaa8, 0xc0c1e197c952650e, 0xe380e0d860298f17, 0x03e107eb3a42b2ec]),
        ],
        // Round 11
        [
            Fr::from_raw([0x454505f6941d78cd, 0x46452ca57c08697f, 0x69c0d52bf88b772c, 0x2d354a251f381a46]),
            Fr::from_raw([0xd14b4606826f794b, 0x522551d61606eda3, 0xf687ef14bc566d1c, 0x094af88ab05d94ba]),
            Fr::from_raw([0xd52b2d249d1396f7, 0xe1ab5b6f2e3195a9, 0x19bcaeabf02f8ca5, 0x19705b783bf3d2dc]),
        ],
        // Round 12
        [
            Fr::from_raw([0x60cef6852271200e, 0x8723b16b7d740a3e, 0x1fcc33fee54fc5b2, 0x09bf4acc3a8bce3f]),
            Fr::from_raw([0x543a073f3f3b5e4e, 0x3413732f301f7058, 0x50f83c0c8fab6284, 0x1803f8200db6013c]),
            Fr::from_raw([0xd41f7fef2faf3e5c, 0xbf6fb02d4454c0ad, 0x30595b160b8d1f38, 0x0f80afb5046244de]),
        ],
        // Round 13
        [
            Fr::from_raw([0x7dc3f98219529d78, 0xabcfcf643f4a6fea, 0xd77f0088c1cfc964, 0x126ee1f8504f15c3]),
            Fr::from_raw([0xef86f991d7d0a591, 0x0ffb4ee63175ddf8, 0x69bfb3d919552ca1, 0x23c203d10cfcc60f]),
            Fr::from_raw([0x7c5a339f7744fb94, 0x3dec1ee4eec2cf74, 0xec0d09705fa3a630, 0x2a2ae15d8b143709]),
        ],
        // Round 14
        [
            Fr::from_raw([0xb6b5d89081970b2b, 0xc3d3b3006cb461bb, 0x47e5c381ab6343ec, 0x07b60dee586ed6ef]),
            Fr::from_raw([0x132cfe583c9311bd, 0x8a98a320baa7d152, 0x885d95c494c1ae3d, 0x27316b559be3edfd]),
            Fr::from_raw([0x2f5f9af0c0342e76, 0xef834cc2a743ed66, 0xd8937cb2d3f84311, 0x1d5c49ba157c32b8]),
        ],
        // Round 15
        [
            Fr::from_raw([0x7c24bd5940968488, 0x09c01bf6979938f6, 0x332774e0b850b5ec, 0x2f8b124e78163b2f]),
            Fr::from_raw([0x665f75260113b3d5, 0x1d4cba6554e51d84, 0xdc5b7aa09a9ce21b, 0x1e6843a5457416b6]),
            Fr::from_raw([0x1f5bc79f21641d4b, 0xa68daf9ac6a189ab, 0x5fca25c9929c8ad9, 0x11cdf00a35f650c5]),
        ],
        // Round 16
        [
            Fr::from_raw([0xe82b5b9b7eb560bc, 0x608b2815c77355b7, 0x2ef36e588158d6d4, 0x21632de3d3bbc5e4]),
            Fr::from_raw([0x49d7b5c51c18498a, 0x255ae48ef2a329e4, 0x97b27025fbd245e0, 0x0de625758452efbd]),
            Fr::from_raw([0x9b09546ba0838098, 0xdd9e1e1c6f0fb6b0, 0xe2febfd4d976cc01, 0x2ad253c053e75213]),
        ],
        // Round 17
        [
            Fr::from_raw([0xd35702e38d60b077, 0x3dd49cdd13c813b7, 0x6ec7681ec39b3be9, 0x1d6b169ed63872dc]),
            Fr::from_raw([0xc3a54e706cfef7fe, 0x0be3ea70a24d5568, 0xb9127c4941b67fed, 0x1660b740a143664b]),
            Fr::from_raw([0x96a29f10376ccbfe, 0xceacdddb12cf8790, 0x114f4ca2deef76e0, 0x0065a92d1de81f34]),
        ],
        // Round 18
        [
            Fr::from_raw([0xcf30d50a5871040d, 0x353ebe2ccbc4869b, 0x7367f823da7d672c, 0x1f11f06520253598]),
            Fr::from_raw([0x110852d17df0693e, 0x3bd1d1a39b6759ba, 0xb437ce7b14a2c3dd, 0x26596f5c5dd5a5d1]),
            Fr::from_raw([0x6743db15af91860f, 0x8539c4163a5f1e70, 0x7bf3056efcf8b6d3, 0x16f49bc727e45a2f]),
        ],
        // Round 19
        [
            Fr::from_raw([0xe1a4e7438dd39e5f, 0x568feaf7ea8b3dc5, 0x9954175efb331bf4, 0x1abe1deb45b3e311]),
            Fr::from_raw([0x020d34aea15fba59, 0x9f5db92aaec5f102, 0xd8993a74ca548b77, 0x0e426ccab66984d1]),
            Fr::from_raw([0xa841924303f6a6c6, 0x0071684b902d534f, 0x4933bd1942053f1f, 0x0e7c30c2e2e8957f]),
        ],
        // Round 20
        [
            Fr::from_raw([0x4c76e1f31d3fc69d, 0x6166ded6e3528ead, 0x1622708fc7edff1d, 0x0812a017ca92cf0a]),
            Fr::from_raw([0x2e276b47cf010d54, 0x68afe5026edd7a9c, 0xbba949d1db960400, 0x21a5ade3df2bc1b5]),
            Fr::from_raw([0x72b1a5233f8749ce, 0xbd101945f50e5afe, 0xad711bf1a058c6c6, 0x01f3035463816c84]),
        ],
        // Round 21
        [
            Fr::from_raw([0x4dcaa82b0f0c1c8b, 0x8bf2f9398dbd0fdf, 0x028c2aafc2d06a5e, 0x0b115572f038c0e2]),
            Fr::from_raw([0x3460613b6ef59e2f, 0x27fc24db42bc910a, 0xf0ef255543f50d2e, 0x1c38ec0b99b62fd4]),
            Fr::from_raw([0xb1d0b254d880c53e, 0x2f5d314606a297d4, 0x425c3ff1f4ac737b, 0x1c89c6d9666272e8]),
        ],
        // Round 22
        [
            Fr::from_raw([0x8b71e2311bb88f8f, 0x21ad4880097a5eb3, 0xf6d44008ae4c042a, 0x03326e643580356b]),
            Fr::from_raw([0x5bdde2299910a4c9, 0x50f27a6434b5dceb, 0x67cee9ea0e51e3ad, 0x268076b0054fb73f]),
            Fr::from_raw([0x78d04aa6f8747ad0, 0x5da18ea9d8e4f101, 0x626ed93491bda32e, 0x1acd63c67fbc9ab1]),
        ],
        // Round 23
        [
            Fr::from_raw([0xca8c86cd2a28b5a5, 0x1bf93375e2323ec3, 0xc4e3144be58ef690, 0x19f8a5d670e8ab66]),
            Fr::from_raw([0xe1cfbb5f7b9b6893, 0x068193ea51f6c92a, 0x6efa40d2df10a011, 0x1c0dc443519ad7a8]),
            Fr::from_raw([0x180e4c3224987d3d, 0xfbeab33cb4f6a2c4, 0x50fe7190e421dc19, 0x14b39e7aa4068dbe]),
        ],
        // Round 24
        [
            Fr::from_raw([0xafb1e35e28b0795e, 0xb820fc519f01f021, 0x8f28c63ea6c561b7, 0x1d449b71bd826ec5]),
            Fr::from_raw([0x76524dc0a9e987fc, 0x89de141689d12522, 0x60fa97fe60fe9d8e, 0x1ea2c9a89baaddbb]),
            Fr::from_raw([0x134d5cefdb3c7ff1, 0x591f9a46a0e9c058, 0xb57e9c1c3d6a2bd7, 0x0478d66d43535a8c]),
        ],
        // Round 25
        [
            Fr::from_raw([0x1cde5e4a7b00bebe, 0x662e26ad86c400b2, 0xf608f3b2717f9cd2, 0x19272db71eece6a6]),
            Fr::from_raw([0x039be846af134166, 0xb2dd1bd66a87ef75, 0xc749c746f09208ab, 0x14226537335cab33]),
            Fr::from_raw([0xf912f44961f9a9ce, 0xb21c21e4a1c2e823, 0x9dfe38c0d976a088, 0x01fd6af15956294f]),
        ],
        // Round 26
        [
            Fr::from_raw([0x5ad8518d4e5f2a57, 0xaee2e62ed229ba5a, 0x7bca190b8b2cab1a, 0x18e5abedd626ec30]),
            Fr::from_raw([0x0e2d54dc1c84fda6, 0x97c021a3a409926d, 0xabbdffa6d3b35e32, 0x0fc1bbceba0590f5]),
            Fr::from_raw([0x722513091c0f90c9, 0x69e737481ad3376d, 0xca1d8a1e828d6fb9, 0x30347f53e91a637f]),
        ],
        // Round 27
        [
            Fr::from_raw([0x955254e81e2f98b7, 0x2b475bca9222507c, 0x5bbb3625c3b071a4, 0x0de59a358f0ecd2d]),
            Fr::from_raw([0xcc96f373156ecf16, 0x74b77a8de8088d62, 0x6ade0fad02397438, 0x192367e65f923e2f]),
            Fr::from_raw([0x87fb421d18dc887d, 0x85c66affc3a6b6ca, 0x3f830a979873e596, 0x01a992b6af0424b9]),
        ],
        // Round 28
        [
            Fr::from_raw([0x69acd5bd3ef74ec8, 0xe69ff2b4a8069c88, 0x01bb81c2f854ad8e, 0x1e9bdf5427a56207]),
            Fr::from_raw([0x547f82d6082f7a42, 0xba8d4adaf1d05142, 0x9daa27f20a017a07, 0x1b256e0fb7d5ec33]),
            Fr::from_raw([0x28256d1b1ef38e70, 0x2b4db734215d1b8d, 0x42a53a531910f9a3, 0x2a5bc4ad257499ea]),
        ],
        // Round 29
        [
            Fr::from_raw([0x008f29a51b837f90, 0x18f4bb1c58e49c51, 0x471c4df705b59ac0, 0x27fcec3b431befcb]),
            Fr::from_raw([0x5533ef8556278a6c, 0x7e1b8f20e81273eb, 0xe1b57afce557ef94, 0x22961d12dc1f96bc]),
            Fr::from_raw([0x824d8597f7a1ee1d, 0xcaeaa2086307c785, 0x159dc124b2dd142f, 0x011c5653ac8b64cd]),
        ],
        // Round 30
        [
            Fr::from_raw([0x5a059c31d45681df, 0xa35856fdfbff1bf8, 0x1bb7f14a272f5535, 0x1d519feae9827d0b]),
            Fr::from_raw([0x0bfb2ace24f85c7c, 0xd48ba40840a73618, 0x3617767f07407f43, 0x2ee9619acd36e9ec]),
            Fr::from_raw([0xbf49e225930593db, 0x98c670f6363a7e83, 0x06efaadc0c12122e, 0x2637f99fce7463a9]),
        ],
        // Round 31
        [
            Fr::from_raw([0x892c7bc6de6c5fa8, 0x0b9e4526c415ac38, 0xfd8f15456b011e1d, 0x1c12745737824622]),
            Fr::from_raw([0x3947c8be4d4ee971, 0xcf46a209c7c56316, 0xc78fbb1eb365c232, 0x19b98d3fc8e2b487]),
            Fr::from_raw([0x05e12bf8d3e3fecf, 0x2548edbbea40951a, 0x8c9e5fc181190a5c, 0x04bf0ee44e25b5b0]),
        ],
        // Round 32
        [
            Fr::from_raw([0xd3a789216b7f6718, 0x7efc62d62e31404e, 0xf7da6febb71116e4, 0x1508862a72542035]),
            Fr::from_raw([0xc93483c58e651560, 0xa6c001641752ccd3, 0x0d17cd476adc475c, 0x29684cede059b92e]),
            Fr::from_raw([0x5b13525d22fae357, 0x7a5d7203cedf2e1e, 0xf9de635c42f2f481, 0x11fba1de926dc812]),
        ],
        // Round 33
        [
            Fr::from_raw([0xae6e048d1407695c, 0xb62dc3229bd5951b, 0xaa2cab67a1e377f0, 0x1c79b44ba583f341]),
            Fr::from_raw([0xf0e265272d406547, 0x9d4ed20e9a725159, 0x5f8981e3bef465f4, 0x0efac6637312c702]),
            Fr::from_raw([0xa4c31ec29a65ed71, 0x0414b3ca42d99011, 0x9bdae42661a2494d, 0x0202e9abde9c9628]),
        ],
        // Round 34
        [
            Fr::from_raw([0xbdab55f7bd7a6e36, 0xeb65d92099c4f2e6, 0x25ba84ad7540b380, 0x182965cfa2bd9015]),
            Fr::from_raw([0x78d84810e5b3fcbc, 0xd50cd22e08bb9c70, 0x13de90198396845e, 0x2b228d8943f9f31b]),
            Fr::from_raw([0xa82bf5b7f8b53189, 0x7134dcc67af29cce, 0xbdaf4f7a66de2321, 0x00d577d378751869]),
        ],
        // Round 35
        [
            Fr::from_raw([0x4b1216cf007135b6, 0xac4ab168a524ecc1, 0xcbe2e286dcdc284c, 0x243b0fa88aedc975]),
            Fr::from_raw([0xbb64b331e0e8f39f, 0x7dbed93efbf39852, 0x6b693322655afe50, 0x27c7ca4bf4290d1e]),
            Fr::from_raw([0x5a8432364a9f2b9b, 0xc9b1b6d3330a13e0, 0x31652793025c0b3b, 0x27d0ab1d52d5dafa]),
        ],
        // Round 36
        [
            Fr::from_raw([0x667632a10a6237bf, 0x3b71e8cdc6b20a2c, 0x70cf9be344461198, 0x14ae1c11de5120e6]),
            Fr::from_raw([0x54ab0fee62b03e8b, 0x23804c387d91e980, 0x75a0abaab4373896, 0x23d1b30e1e91dc02]),
            Fr::from_raw([0x9eaa36ec4a768011, 0x07b4046697f44a6a, 0x3728c4c945200c5d, 0x2d3071b44b0819a3]),
        ],
        // Round 37
        [
            Fr::from_raw([0xe9c17584f0578bdb, 0x19abe4e74255d170, 0x43588e11dce44e8d, 0x1c91211710526c8d]),
            Fr::from_raw([0x3fe7e877658e3154, 0x8c970c63e9de1a17, 0xc9494762bd423bf0, 0x124d84d94425e4dc]),
            Fr::from_raw([0xe96e0364711669b8, 0x632e918208bc645f, 0x30f59af8443b4f79, 0x0a0487e7fe653ff6]),
        ],
        // Round 38
        [
            Fr::from_raw([0xca9488330a037bb8, 0xce6df40b60a158fa, 0x10202d63a195e5a1, 0x10a8c9fa3ae6b3f0]),
            Fr::from_raw([0x3dc57d6043d7821c, 0x8203879551ccc4bf, 0x8d97b24a71990ed3, 0x168dc103f522a455]),
            Fr::from_raw([0x955e954c18b33a8b, 0x3e0f7be7d6d8e2a1, 0x6f6b4d36d00a86b0, 0x22417ea97fa7ab92]),
        ],
        // Round 39
        [
            Fr::from_raw([0x4d4c4588ddd62c84, 0xaabfae97ef1e6664, 0x8e4539a1bc5d2c88, 0x2a6174d4b9fa9053]),
            Fr::from_raw([0xeb4a3dbd496def2f, 0xa0ec8f3053b06f4f, 0xf1f753f5f85fe03b, 0x1cc248057eb0fd28]),
            Fr::from_raw([0x664e502bea28462e, 0x51917d56eb9e6779, 0xdb26d85746562d0b, 0x14dbcc08b921c358]),
        ],
        // Round 40
        [
            Fr::from_raw([0xaddb965bf3e3a372, 0xebd3eb9da7857fb0, 0x1ebdf33afcb5babf, 0x1d28a4f9cd614655]),
            Fr::from_raw([0x5574a8085d74b5b3, 0x1df7f00fca9d73b5, 0x799615f5f5296146, 0x1596900ce091cea8]),
            Fr::from_raw([0xea7684bbb6e18837, 0xe5ca3101c2ea84e1, 0xc2ff0dbca6a34784, 0x0978d75a71e9cccc]),
        ],
        // Round 41
        [
            Fr::from_raw([0x6644e73d8d925dd7, 0xe7fa17c075872e05, 0x14d158726ce96b73, 0x1b1f1cb131cb037d]),
            Fr::from_raw([0xac95b01934938e62, 0xe508af74557fb1da, 0x73e482762012502e, 0x156eecc345d11b00]),
            Fr::from_raw([0x15df556815548d02, 0x6def8d1f1640804b, 0x3cd90416eb80593e, 0x224421a4d0a2fe50]),
        ],
        // Round 42
        [
            Fr::from_raw([0x4fe5832cb47e437d, 0x6a9a106533a67720, 0x8c75376232dfa666, 0x0a17879cf1b30bea]),
            Fr::from_raw([0xf605c498e663c817, 0x6db9bb4ebe637705, 0x6269ed32efbc55ee, 0x25da75173ebcbd28]),
            Fr::from_raw([0x8e983b1642929927, 0xbbbdc335dcbd30fd, 0x3e1186ef3dedb586, 0x0aa00a02a1857406]),
        ],
        // Round 43
        [
            Fr::from_raw([0xd1fe9358f8b94aad, 0x2c441c1cb34c4001, 0x75f50acdaa379c04, 0x300e19c48ed48661]),
            Fr::from_raw([0x3a5ea1b0c4f6d630, 0x808e3653d322ac30, 0x7c99e04f7d34d725, 0x2f22e43e2ec235da]),
            Fr::from_raw([0x005a50ccf490ea4c, 0xe7c7665ec79da9ee, 0xb61f76a0122c0b67, 0x03adcd0ed6032a56]),
        ],
        // Round 44
        [
            Fr::from_raw([0x5ab8807fcd2435a7, 0xb3e9be47a9c9768f, 0xcbdf5121cf44d611, 0x235297c114d27b55]),
            Fr::from_raw([0x14be7287a2f8b4c8, 0x89168f09c65ed441, 0x75f3375eff839c26, 0x10f1182b447cff33]),
            Fr::from_raw([0xa10c4fcf49a57966, 0x61c2ab95de1e7ffb, 0x7b6441703ce1a57e, 0x1e6adbf939724780]),
        ],
        // Round 45
        [
            Fr::from_raw([0x1a4b045380135456, 0xa88939a33c810f76, 0x63833020c75eb00e, 0x01a0c48c7936505b]),
            Fr::from_raw([0xa4e77703be6d030e, 0x57bcebd012ae5e7a, 0xc3577fbaa65b4fda, 0x2dbc47b5021936f8]),
            Fr::from_raw([0xeb332b35ee5a468c, 0x1185a3c928b09d46, 0x5756d28092195e93, 0x1327666b84984cf6]),
        ],
        // Round 46
        [
            Fr::from_raw([0x18ac39d308636ca9, 0x7e169397ed56d8be, 0x3c28edc8c725f79d, 0x2bc934e3f91921ec]),
            Fr::from_raw([0xf8f03221824a5cc0, 0xb87802d66f897aea, 0xd564b267c43b5e5e, 0x183dd78940fbb6ec]),
            Fr::from_raw([0xc23688aca7fa205b, 0x167c54563dd350fa, 0x5cf5a9377346efac, 0x2c3b99c113caa821]),
        ],
        // Round 47
        [
            Fr::from_raw([0xe8ef87a9d82830cd, 0xf010313bec2406b7, 0x9778251924fcbb0d, 0x0cfc218f63c5a59e]),
            Fr::from_raw([0x2b6e075992bc073d, 0x759539b27c2f4d93, 0xa3c9fbb8e1cdba31, 0x301a1be9217e2cbf]),
            Fr::from_raw([0xbcfc996f0a8b8d4f, 0x5ecb8636f42c4e2c, 0x2bd56d3b05303d39, 0x0451168db6416d9a]),
        ],
        // Round 48
        [
            Fr::from_raw([0x6e52da33bd117458, 0x662bee641c5df4a9, 0x8032c8ae75f1aca0, 0x0279fe381976eda4]),
            Fr::from_raw([0x29527d36c740e678, 0x747ef420a5f0d758, 0x793948270d814241, 0x2dd3f1dea0c8d9f4]),
            Fr::from_raw([0x8d81dbb26682f28b, 0xfdf255ac8d6694d1, 0xeaec0104a0008897, 0x1bde2068fd10ccc3]),
        ],
        // Round 49
        [
            Fr::from_raw([0xbe59a3213b047613, 0xdff84104178e67c3, 0xc819de04a1a15e1b, 0x18e9925c649a6bf7]),
            Fr::from_raw([0x95d055cb4323bd14, 0x03716d7aad74c227, 0x2722a9b137a625c9, 0x0281fc392973d497]),
            Fr::from_raw([0xdf4e63e8db363415, 0x4fe26ae2e9c7d161, 0x9b3d7a20e7845f38, 0x0757134be627b5ff]),
        ],
        // Round 50
        [
            Fr::from_raw([0x78d8dee4db8cb576, 0xdb332e1e5c0f67d7, 0xb45df5375e5aff61, 0x1e96e7da78032be3]),
            Fr::from_raw([0xbd0b65b976de377c, 0x50fd257d13c87c4b, 0x5c6f4c615904cbde, 0x10e29927e946e814]),
            Fr::from_raw([0xe7e98192104d6c60, 0x67bc3bc3340b86ea, 0x4a0e03d4f115e831, 0x104f75276d0da236]),
        ],
        // Round 51
        [
            Fr::from_raw([0x04b0bd5ed1cd62dc, 0x69624075cb6dfa5a, 0xd255e95d5e962ba9, 0x01c6368cb969e2f8]),
            Fr::from_raw([0x37a5a15cd32be88f, 0xb30a6e067befab88, 0x764af0e7f76856e1, 0x106fffc94ca4acbd]),
            Fr::from_raw([0x569b52010f0c95a2, 0x4fcbc3515aed35dd, 0x7dbd8a0155728c64, 0x15e78bf1f7c8bfe1]),
        ],
        // Round 52
        [
            Fr::from_raw([0xa38f5515985d16b8, 0x8d8c192e3c02d598, 0x718fe666467055d1, 0x000cab14c0ff2cf1]),
            Fr::from_raw([0x017803bb1abf9c75, 0x3f45d4deea6ce7ff, 0x9f328e6141909b90, 0x23f34102470d9482]),
            Fr::from_raw([0xee0fc2aaa6935da6, 0xe2cf207b0d323ba0, 0x1d65f6ef7284f392, 0x1fd2d8ce7613d6b6]),
        ],
        // Round 53
        [
            Fr::from_raw([0x02cbdd24374fad45, 0xdf03695bad70b3ac, 0xfa13fc8a57d078f0, 0x0c63086a8a20a108]),
            Fr::from_raw([0xaab631aae5a2b54c, 0x6b185fcc2f0e548e, 0xfdb215a5c8d967f4, 0x27cd3730e4714199]),
            Fr::from_raw([0x5ec79c1e524be22b, 0x4cd1a1cf69f15fca, 0x186c0d4d4a016460, 0x15adaa75fc1f1595]),
        ],
        // Round 54
        [
            Fr::from_raw([0x853183fb7ae19d02, 0xd1e15619a346a9e8, 0x6fe71314cdc4d64b, 0x05aa5e4fb8493122]),
            Fr::from_raw([0x31c13fb6a57c4022, 0x3ccb7a9a8ea245ac, 0x58313959fcfc621a, 0x27fb8cd694fcd1d0]),
            Fr::from_raw([0x713b207ad34ec7a7, 0x17565d61af26c621, 0xe463ee9a3f70e3e8, 0x2be0953fd8b1d2f6]),
        ],
        // Round 55
        [
            Fr::from_raw([0xfce03b25d20c25a2, 0x469fcbe87b9c1ab6, 0xf116ca2a15fc36cc, 0x217143e8ae458a9e]),
            Fr::from_raw([0x16fa11b3d59328f2, 0xf945e1eba04fbcd9, 0xcffd3123a0118d90, 0x29c3b69f65b5cfd2]),
            Fr::from_raw([0xf81c16c84ed32fe9, 0x8e99662b3311144e, 0x603de573d11918a9, 0x2951ccd20b0a35b9]),
        ],
        // Round 56
        [
            Fr::from_raw([0xac4bcfba87dbd048, 0x7b9ee088de1db8b7, 0xb69b64f3e7d60961, 0x202d7cf41dcbbb10]),
            Fr::from_raw([0x9b1ad0686c3743b5, 0xc036a1e0d377cfcc, 0x5b39dddc6f0395ee, 0x014d390c7229d74a]),
            Fr::from_raw([0xdd7e97292296262e, 0x16f7dfa3ebfcc3d4, 0x40820dc11e59d9bf, 0x1479c1cfbd488172]),
        ],
        // Round 57
        [
            Fr::from_raw([0x816fcd74b562dfa0, 0xd4a96d8b6c61ded5, 0x0f65d8933ab43397, 0x0684d98bb9676175]),
            Fr::from_raw([0xe4008373c89447a8, 0x892cd50179df7ce1, 0xda05a729297a2a5f, 0x1f4f4cd32539eddc]),
            Fr::from_raw([0xd958ffb04635b84f, 0x1dfd792a5351c10b, 0x371731b5752d957d, 0x03326d7fdcd6ccc2]),
        ],
        // Round 58
        [
            Fr::from_raw([0xbd76a271cb6e876d, 0x0a5688d7e4965aaf, 0x75bd7f99d1a95d7f, 0x1d5b99cb1e95e9d9]),
            Fr::from_raw([0x496f0513d2af1054, 0x4174cc9f6ff6b8ba, 0x4e9978dae7f77a01, 0x13d909a621a86fcb]),
            Fr::from_raw([0x13c45e28174d17ce, 0x18221f7bd7f899e3, 0xcdbf3270e8bf1c4f, 0x16e7671d2d3a50c7]),
        ],
        // Round 59
        [
            Fr::from_raw([0x0c5323684153fdcd, 0x294c6af6b5900c70, 0xad82466f062d38d8, 0x03aac5e52aedb6ac]),
            Fr::from_raw([0x96d0886c81916d34, 0xdf3a4c8c93e292c9, 0xdc2c19a3332faba6, 0x086f0806c45cf713]),
            Fr::from_raw([0x34e1f85a2e20e969, 0x1f9807d575b0d88a, 0x1a40a14687da5aa9, 0x2a845e4cb08384e5]),
        ],
        // Round 60
        [
            Fr::from_raw([0x742d1e0eccf06e8b, 0xcab18b6a62efe2f4, 0x005f3b2804cbeea1, 0x18d2a59257afc8bd]),
            Fr::from_raw([0x9b8ad15be5361be9, 0x610dea2873181602, 0x4d53e69338e5fb98, 0x1a2d3094ec6931ac]),
            Fr::from_raw([0xaeca0df6089cad6d, 0xd300210260c1d589, 0x5299978e53f555dc, 0x1cfe7a330a500182]),
        ],
        // Round 61
        [
            Fr::from_raw([0x7e2784530825b921, 0x33f2fdbc19255305, 0xea59002d40230b89, 0x0da40fff9f10c73a]),
            Fr::from_raw([0xc0393df01e079ff5, 0x6561de1faec70eef, 0xdbf6e8e234f30c84, 0x0e05b77a1a396b75]),
            Fr::from_raw([0x325f918029bf262e, 0x2151bec40f3084b4, 0xdcd58b95d6656a45, 0x1a044b846a4bb239]),
        ],
        // Round 62
        [
            Fr::from_raw([0xa89493b0ea189784, 0xc349540db935e2bc, 0x78043335ddcab1b8, 0x2e139ae51418b64f]),
            Fr::from_raw([0x70ee063a7f676240, 0xe4f28f77af515b11, 0x94a0228663125866, 0x0741808912ca9cbf]),
            Fr::from_raw([0x7f69b40d94e8cc91, 0x8642e04600321880, 0xf70f9059bb80e360, 0x0b29628ee57e1d55]),
        ],
        // Round 63
        [
            Fr::from_raw([0x565f949933fbf9d1, 0xa21ddf46b4631583, 0xdd5475cdcabce8af, 0x060804c31fb3be30]),
            Fr::from_raw([0x36d3955e853b3592, 0xd195fa252b0cd84f, 0x63f9bd30d8cb6002, 0x2760f6b6590a73a8]),
            Fr::from_raw([0x67d6f228492c2c5b, 0x2c65b571104def5a, 0x6fa53cb6d2e0537c, 0x14aa7543a56c144a]),
        ],
    ]
}

/// Pre-computed MDS matrix (3x3)
pub fn mds_matrix() -> Mds<Fr, 3> {
    [
        [
            Fr::from_raw([0x227f14ac41bc4cd3, 0x76f479f8fa4b34f1, 0x625ea9db1f247c63, 0x09600146bec7f4fd]),
            Fr::from_raw([0x570e848cb09c9292, 0x48080f6a139f5a64, 0x41b430e81e9f5fa6, 0x1eb832b908b873be]),
            Fr::from_raw([0x8b63cccbea20d8af, 0x7a26db160ae28eb9, 0x5b01fc0c44f5d236, 0x00868c3677aaeb8a]),
        ],
        [
            Fr::from_raw([0x99a4614a96504ebe, 0x44663a2bf55db569, 0x0ece763cbb2094c4, 0x0b9a382db8289f52]),
            Fr::from_raw([0x4bbcda5acdc435ec, 0xef4e1936fb876d03, 0xd2879cdcc47c1113, 0x2de7772476f303a6]),
            Fr::from_raw([0xbc44e7a2dd3d793d, 0x24da6487f1b18fdb, 0x05572ebbde236b76, 0x27948d4bcb6d6652]),
        ],
        [
            Fr::from_raw([0xf645471265344dc4, 0xa1e31f41f7ce7631, 0xed028865d2f9ef22, 0x1fcefc218b5675fe]),
            Fr::from_raw([0xae612716ce444b3b, 0x96770fdc936f9b16, 0xdfd828024c172965, 0x0d7b02b0f922e679]),
            Fr::from_raw([0x46fdc664ee4511c7, 0xf17410f229a1271d, 0xca16a9f3c1f9bc4f, 0x1ee23b55636874a2]),
        ],
    ]
}

/// Pre-computed inverse MDS matrix (3x3)
pub fn mds_inv_matrix() -> Mds<Fr, 3> {
    [
        [
            Fr::from_raw([0x2f1e66ed55f9c9fc, 0x3e91e73306f0cd43, 0x4def04f67ea4695d, 0x1853f03f9b252eeb]),
            Fr::from_raw([0x22b56ca429c363fc, 0x44db50db384d01a1, 0x531ce5e3792c9936, 0x132185516ff7885d]),
            Fr::from_raw([0xe9f26d10389937e7, 0x79a6862e163c5e40, 0x7ccd2f5fd6e0a05b, 0x048c9fd0418a78de]),
        ],
        [
            Fr::from_raw([0xb782b5fc2ef1eef5, 0x0e6a2162b3311237, 0x22535c06418140c4, 0x1c57f77f7c6e2d70]),
            Fr::from_raw([0x670aef95c403752a, 0x40e64ba0515d988e, 0x249acf6af5d2bddc, 0x1e830536445074ac]),
            Fr::from_raw([0x8051c9632e142537, 0x025c31fa10473f62, 0x34ad7a9180132c72, 0x255e46607289f388]),
        ],
        [
            Fr::from_raw([0x24ebea472f8a4181, 0xa61725cbff027a2e, 0xc0ec02fce8d51fde, 0x092ca526b2fdef96]),
            Fr::from_raw([0xa7cbe164eddf2ed1, 0x69396c30ce1a1bf4, 0xa2c30b2e3432d199, 0x00f2380249580f86]),
            Fr::from_raw([0x80de8813ede171ea, 0xa0e3f64ce8b0590a, 0x100bea16d54ec9e3, 0x0f03e31e34235cbb]),
        ],
    ]
}
