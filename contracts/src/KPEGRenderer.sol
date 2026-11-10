// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IKPEGArtLayerSource {
    function svg(uint8 index) external pure returns (string memory);
}

contract KPEGRenderer {
    uint8 public constant CANVAS_SIZE = 32;

    struct KittyTraitIds {
        uint8 background;
        uint8 breed;
        uint8 clothes;
        uint8 mood;
        uint8 marks;
        uint8 mouth;
        uint8 eyes;
        uint8 accessory;
    }

    struct KittyTraitNames {
        string background;
        string breed;
        string clothes;
        string mood;
        string marks;
        string mouth;
        string eyes;
        string accessory;
    }

    struct ArtSourceRef {
        address source;
        uint8 index;
    }

    error InvalidArtSources();

    ArtSourceRef[][] private backgroundSources;
    ArtSourceRef[][] private breedSources;
    ArtSourceRef[][] private clothesSources;
    ArtSourceRef[][] private moodSources;
    ArtSourceRef[][] private markSources;
    ArtSourceRef[][] private mouthSources;
    ArtSourceRef[][] private eyeSources;
    ArtSourceRef[][] private accessorySources;

    string[6] private BACKGROUND_NAMES = ["White", "Sky", "Mint", "Coral", "Lilac", "Midnight"];
    string[20] private BREED_NAMES = [
        "American Shorthair",
        "British Shorthair",
        "Siamese",
        "Persian",
        "Maine Coon",
        "Bengal",
        "Scottish Fold",
        "Munchkin",
        "Ragdoll",
        "Calico",
        "Bombay",
        "Norwegian Forest",
        "Abyssinian",
        "Devon Rex",
        "Russian Blue",
        "Sphynx",
        "Turkish Van",
        "Tuxedo",
        "Nebelung",
        "Alien Cat"
    ];
    string[18] private CLOTHES_NAMES = [
        "None",
        "Red Bandana",
        "Green Bandana",
        "Blue Bowtie",
        "Cozy Hoodie",
        "Sailor Shirt",
        "Frog Onesie",
        "Dino Costume",
        "Pink Scarf",
        "Yellow Raincoat",
        "Purple Sweater",
        "Gold Collar",
        "Space Helmet",
        "Meteor Hoodie",
        "Moon Cloak",
        "Silk Sash",
        "Star Cape",
        "Wizard Hat"
    ];
    string[12] private MOOD_NAMES = [
        "None",
        "Sparkles",
        "Hearts",
        "Sleep Zzz",
        "Sweat Drop",
        "Coin Glow",
        "Purple Moon",
        "Fireflies",
        "Lucky Breeze",
        "Tiny Storm",
        "Aurora",
        "Moonlit"
    ];
    string[4] private MARK_NAMES = ["None", "Blush", "Cream Muzzle", "Tiny Scar"];
    string[12] private MOUTH_NAMES = [
        "Happy V",
        "Smiling W",
        "Pout",
        "Stoic",
        "Wonder O",
        "Tongue Out",
        "Grumpy",
        "Smirk",
        "Calm Smile",
        "Fishy Bite",
        "Tiny Fang",
        "Yawn"
    ];
    string[12] private EYES_NAMES = [
        "Happy ^_^",
        "Blue Eyes",
        "Winking",
        "Amber Eyes",
        "Bored Eyes",
        "Heterochromia",
        "Emerald Eyes",
        "Sleepy",
        "Crossed Eyes",
        "Glassy Eyes",
        "Gold Eyes",
        "Void Eyes"
    ];
    string[17] private ACCESSORY_NAMES = [
        "None",
        "Gold Crown",
        "Fish Snack",
        "Yarn Ball",
        "Star Pin",
        "Round Glasses",
        "Heart Charm",
        "ETH Pendant",
        "BTC Tag",
        "Cat Wand",
        "Comet Charm",
        "Crystal Ball",
        "Feather Teaser",
        "Lucky Coin",
        "Magic Wand",
        "Moonfish",
        "Tiny Bell"
    ];

    uint16[20][5] private BREED_WEIGHTS = [
        [uint16(13), 12, 6, 8, 5, 3, 8, 8, 2, 6, 6, 2, 6, 2, 4, 1, 4, 3, 1, 0],
        [uint16(9), 8, 7, 7, 7, 5, 6, 6, 5, 6, 5, 4, 6, 3, 4, 2, 4, 3, 2, 1],
        [uint16(6), 6, 8, 5, 8, 8, 5, 5, 7, 7, 4, 6, 5, 3, 4, 2, 3, 3, 4, 1],
        [uint16(5), 5, 7, 5, 7, 9, 4, 3, 7, 6, 4, 10, 5, 3, 4, 2, 3, 3, 5, 3],
        [uint16(3), 3, 8, 4, 8, 12, 2, 2, 10, 6, 3, 12, 5, 3, 4, 2, 3, 2, 5, 3]
    ];

    uint16[18][5] private CLOTHES_WEIGHTS = [
        [uint16(30), 15, 13, 10, 7, 7, 4, 3, 4, 3, 2, 1, 1, 0, 0, 0, 0, 0],
        [uint16(23), 13, 11, 9, 8, 8, 5, 4, 5, 4, 3, 1, 1, 1, 1, 1, 1, 1],
        [uint16(19), 11, 9, 8, 8, 8, 6, 5, 6, 5, 4, 2, 1, 2, 2, 2, 1, 1],
        [uint16(14), 9, 8, 7, 7, 7, 7, 6, 7, 6, 5, 2, 2, 3, 3, 3, 2, 2],
        [uint16(12), 7, 7, 6, 6, 7, 7, 8, 6, 5, 5, 3, 3, 4, 4, 4, 3, 3]
    ];

    uint16[12][5] private MOOD_WEIGHTS = [
        [uint16(47), 9, 7, 11, 10, 7, 2, 3, 3, 1, 0, 0],
        [uint16(42), 9, 8, 10, 10, 8, 4, 4, 3, 1, 1, 0],
        [uint16(34), 8, 8, 10, 9, 10, 7, 5, 4, 2, 2, 1],
        [uint16(28), 7, 7, 9, 8, 12, 11, 6, 4, 3, 3, 2],
        [uint16(23), 6, 6, 8, 7, 14, 14, 6, 4, 4, 5, 3]
    ];

    uint16[4][5] private MARK_WEIGHTS = [
        [uint16(56), 20, 18, 6],
        [uint16(48), 24, 19, 9],
        [uint16(40), 26, 20, 14],
        [uint16(34), 26, 20, 20],
        [uint16(30), 25, 20, 25]
    ];

    uint16[12][5] private MOUTH_WEIGHTS = [
        [uint16(23), 20, 12, 15, 6, 6, 4, 3, 7, 1, 1, 2],
        [uint16(20), 18, 12, 14, 8, 8, 4, 3, 6, 2, 2, 3],
        [uint16(17), 16, 12, 12, 11, 11, 4, 3, 5, 3, 3, 3],
        [uint16(14), 14, 11, 10, 14, 15, 4, 4, 4, 3, 4, 3],
        [uint16(11), 12, 10, 8, 16, 18, 4, 4, 4, 3, 5, 5]
    ];

    uint16[12][5] private EYES_WEIGHTS = [
        [uint16(24), 18, 14, 15, 14, 3, 4, 4, 2, 1, 1, 0],
        [uint16(22), 17, 13, 14, 12, 4, 5, 6, 3, 2, 2, 0],
        [uint16(18), 15, 12, 13, 10, 6, 7, 9, 3, 3, 3, 1],
        [uint16(14), 13, 11, 12, 9, 7, 8, 11, 3, 4, 5, 3],
        [uint16(11), 12, 9, 12, 8, 9, 10, 14, 2, 5, 5, 3]
    ];

    uint16[17][5] private ACCESSORY_WEIGHTS = [
        [uint16(39), 4, 17, 0, 7, 9, 7, 5, 3, 0, 0, 0, 5, 1, 0, 0, 3],
        [uint16(30), 4, 13, 4, 6, 8, 8, 7, 7, 1, 0, 1, 5, 2, 1, 1, 2],
        [uint16(22), 4, 9, 7, 5, 7, 8, 10, 10, 2, 1, 2, 4, 3, 2, 2, 2],
        [uint16(14), 5, 7, 8, 4, 6, 9, 11, 12, 3, 2, 3, 3, 5, 3, 3, 2],
        [uint16(10), 5, 6, 8, 3, 5, 8, 12, 14, 4, 3, 4, 2, 5, 4, 4, 3]
    ];

    uint16[6][5] private BACKGROUND_WEIGHTS = [
        [uint16(28), 22, 22, 16, 8, 4],
        [uint16(24), 21, 21, 16, 10, 8],
        [uint16(20), 20, 20, 16, 12, 12],
        [uint16(18), 19, 19, 16, 13, 15],
        [uint16(16), 19, 19, 16, 14, 16]
    ];

    constructor(
        ArtSourceRef[][] memory backgroundSources_,
        ArtSourceRef[][] memory breedSources_,
        ArtSourceRef[][] memory clothesSources_,
        ArtSourceRef[][] memory moodSources_,
        ArtSourceRef[][] memory markSources_,
        ArtSourceRef[][] memory mouthSources_,
        ArtSourceRef[][] memory eyeSources_,
        ArtSourceRef[][] memory accessorySources_
    ) {
        _validateSources(backgroundSources_, 6);
        _validateSources(breedSources_, 20);
        _validateSources(clothesSources_, 18);
        _validateSources(moodSources_, 12);
        _validateSources(markSources_, 4);
        _validateSources(mouthSources_, 12);
        _validateSources(eyeSources_, 12);
        _validateSources(accessorySources_, 17);

        _copySources(backgroundSources_, backgroundSources);
        _copySources(breedSources_, breedSources);
        _copySources(clothesSources_, clothesSources);
        _copySources(moodSources_, moodSources);
        _copySources(markSources_, markSources);
        _copySources(mouthSources_, mouthSources);
        _copySources(eyeSources_, eyeSources);
        _copySources(accessorySources_, accessorySources);
    }

    function _validateSources(ArtSourceRef[][] memory sources, uint256 expectedLength) private pure {
        if (sources.length != expectedLength) revert InvalidArtSources();
        for (uint256 i = 0; i < sources.length; i++) {
            if (sources[i].length == 0) revert InvalidArtSources();
            for (uint256 j = 0; j < sources[i].length; j++) {
                if (sources[i][j].source == address(0)) revert InvalidArtSources();
            }
        }
    }

    function _copySources(ArtSourceRef[][] memory source, ArtSourceRef[][] storage target) private {
        for (uint256 i = 0; i < source.length; i++) {
            target.push();
            for (uint256 j = 0; j < source[i].length; j++) {
                target[i].push(source[i][j]);
            }
        }
    }

    function generateTraits(uint256 kittyId, uint8 tier, bytes32 seed) external view returns (uint256) {
        return _encode(kittyTraitIds(kittyId, tier, seed));
    }

    function kittyTraitIds(uint256 kittyId, uint8 tier, bytes32 seed) public view returns (KittyTraitIds memory) {
        uint8 t = tier > 4 ? 4 : tier;
        uint256 entropy = uint256(keccak256(abi.encodePacked(seed, kittyId, t)));

        KittyTraitIds memory ids;
        ids.breed = _pickBreed(t, entropy);
        ids.clothes = _pickClothes(t, ids.breed, entropy >> 32);
        ids.mouth = _pickMouth(t, ids.breed, entropy >> 64);
        ids.eyes = _pickEyes(t, entropy >> 96);
        ids.accessory = _pickAccessory(t, ids.breed, ids.clothes, entropy >> 128);
        ids.background = _pickBackground(t, ids.breed, entropy >> 224);
        ids.mood = _pickMood(t, ids.mouth, ids.background, entropy >> 160);
        ids.marks = _pickMarks(t, ids.breed, ids.clothes, entropy >> 192);
        return ids;
    }

    function kittyTraits(uint256 packedTraits) external view returns (KittyTraitNames memory) {
        KittyTraitIds memory ids = _decode(packedTraits);
        return KittyTraitNames({
            background: BACKGROUND_NAMES[ids.background],
            breed: BREED_NAMES[ids.breed],
            clothes: CLOTHES_NAMES[ids.clothes],
            mood: MOOD_NAMES[ids.mood],
            marks: MARK_NAMES[ids.marks],
            mouth: MOUTH_NAMES[ids.mouth],
            eyes: EYES_NAMES[ids.eyes],
            accessory: ACCESSORY_NAMES[ids.accessory]
        });
    }

    function kittySvg(uint256 packedTraits, uint8 tier) external view returns (string memory) {
        return _kittySvg(_decode(packedTraits), tier);
    }

    function tokenUriJson(uint256 kittyId, uint8 tier, uint256 packedTraits) external view returns (string memory) {
        return string.concat(
            '{"name":"kPEG #',
            _toString(kittyId),
            '","description":"Immutable onchain kPEG generated from its stored seed.","image_data":"',
            this.kittySvg(packedTraits, tier),
            '","attributes":[{"trait_type":"Tier","value":"',
            _tierName(tier),
            '"},{"trait_type":"Canvas","value":"32x32"},{"trait_type":"Art Source","value":"Onchain"}]}'
        );
    }

    function _pickBreed(uint8 tier, uint256 entropy) private view returns (uint8) {
        uint16 total;
        for (uint8 i = 0; i < 20; i++) {
            total += BREED_WEIGHTS[tier][i];
        }
        return _roll20(BREED_WEIGHTS[tier], entropy % total);
    }

    function _pickClothes(uint8 tier, uint8 breed, uint256 entropy) private view returns (uint8) {
        uint16 total;
        for (uint8 i = 0; i < 18; i++) {
            if (!_isClothesAllowed(breed, i)) continue;
            total += CLOTHES_WEIGHTS[tier][i];
        }
        if (total == 0) return 0;

        uint256 roll = entropy % total;
        uint16 cursor;
        for (uint8 i = 0; i < 18; i++) {
            if (!_isClothesAllowed(breed, i)) continue;
            cursor += CLOTHES_WEIGHTS[tier][i];
            if (roll < cursor) {
                return i;
            }
        }
        return 0;
    }

    function _pickMouth(uint8 tier, uint8 breed, uint256 entropy) private view returns (uint8) {
        uint16 total;
        for (uint8 i = 0; i < 12; i++) {
            if (!_isMouthAllowed(breed, i)) continue;
            total += MOUTH_WEIGHTS[tier][i];
        }
        if (total == 0) return 3;

        uint256 roll = entropy % total;
        uint16 cursor;
        for (uint8 i = 0; i < 12; i++) {
            if (!_isMouthAllowed(breed, i)) continue;
            cursor += MOUTH_WEIGHTS[tier][i];
            if (roll < cursor) {
                return i;
            }
        }
        return 3;
    }

    function _pickMood(uint8 tier, uint8 mouth, uint8 background, uint256 entropy) private view returns (uint8) {
        uint16 total;
        for (uint8 i = 0; i < 12; i++) {
            if (!_isMoodAllowed(mouth, background, i)) continue;
            total += MOOD_WEIGHTS[tier][i];
        }
        if (total == 0) return 0;

        uint256 roll = entropy % total;
        uint16 cursor;
        for (uint8 i = 0; i < 12; i++) {
            if (!_isMoodAllowed(mouth, background, i)) continue;
            cursor += MOOD_WEIGHTS[tier][i];
            if (roll < cursor) {
                return i;
            }
        }
        return 0;
    }

    function _pickMarks(uint8 tier, uint8 breed, uint8 clothes, uint256 entropy) private view returns (uint8) {
        uint16 total;
        for (uint8 i = 0; i < 4; i++) {
            if (!_isMarkAllowed(breed, clothes, i)) continue;
            total += MARK_WEIGHTS[tier][i];
        }
        if (total == 0) return 0;

        uint256 roll = entropy % total;
        uint16 cursor;
        for (uint8 i = 0; i < 4; i++) {
            if (!_isMarkAllowed(breed, clothes, i)) continue;
            cursor += MARK_WEIGHTS[tier][i];
            if (roll < cursor) {
                return i;
            }
        }
        return 0;
    }

    function _pickEyes(uint8 tier, uint256 entropy) private view returns (uint8) {
        uint16 total;
        for (uint8 i = 0; i < 12; i++) {
            total += EYES_WEIGHTS[tier][i];
        }
        return _roll12(EYES_WEIGHTS[tier], entropy % total);
    }

    function _pickAccessory(uint8 tier, uint8 breed, uint8 clothes, uint256 entropy) private view returns (uint8) {
        uint16 total;
        for (uint8 i = 0; i < 17; i++) {
            if (!_isAccessoryAllowed(breed, clothes, i)) continue;
            total += ACCESSORY_WEIGHTS[tier][i];
        }
        if (total == 0) return 0;

        uint256 roll = entropy % total;
        uint16 cursor;
        for (uint8 i = 0; i < 17; i++) {
            if (!_isAccessoryAllowed(breed, clothes, i)) continue;
            cursor += ACCESSORY_WEIGHTS[tier][i];
            if (roll < cursor) {
                return i;
            }
        }
        return 0;
    }

    function _pickBackground(uint8 tier, uint8 breed, uint256 entropy) private view returns (uint8) {
        uint16 total;
        for (uint8 i = 0; i < 6; i++) {
            if (!_isBackgroundAllowed(breed, i)) continue;
            total += BACKGROUND_WEIGHTS[tier][i];
        }
        if (total == 0) return 1;

        uint256 roll = entropy % total;
        uint16 cursor;
        for (uint8 i = 0; i < 6; i++) {
            if (!_isBackgroundAllowed(breed, i)) continue;
            cursor += BACKGROUND_WEIGHTS[tier][i];
            if (roll < cursor) {
                return i;
            }
        }
        return 1;
    }

    function _isBackgroundAllowed(uint8 breed, uint8 background) private pure returns (bool) {
        if ((breed == 2 || breed == 8 || breed == 9) && background == 0) return false;
        if (breed == 10 && background == 5) return false;
        return true;
    }

    function _isClothesAllowed(uint8 breed, uint8 clothes) private pure returns (bool) {
        if (breed == 12 && clothes == 6) return false;
        if (breed == 15 && (clothes == 4 || clothes == 5 || clothes == 6 || clothes == 8 || clothes == 9 || clothes == 10)) return false;
        if (breed == 18 && clothes == 6) return false;
        if (breed == 19 && (clothes == 4 || clothes == 5 || clothes == 6 || clothes == 7 || clothes == 9 || clothes == 10)) return false;
        if (clothes == 13 && (breed == 2 || breed == 3 || breed == 8 || breed == 15 || breed == 19)) return false;
        if ((clothes == 14 || clothes == 15 || clothes == 16) && (breed == 2 || breed == 3 || breed == 8 || breed == 19)) return false;
        if (clothes == 17 && (breed == 10 || breed == 13 || breed == 15 || breed == 19)) return false;
        return true;
    }

    function _isMouthAllowed(uint8 breed, uint8 mouth) private pure returns (bool) {
        if (breed == 15 && (mouth == 0 || mouth == 6)) return false;
        if (breed == 19 && mouth == 0) return false;
        return true;
    }

    function _isAccessoryAllowed(uint8 breed, uint8 clothes, uint8 accessory) private pure returns (bool) {
        if (clothes == 12) {
            return accessory == 0;
        }
        if (accessory == 1 && (clothes == 6 || clothes == 7 || clothes == 12)) {
            return false;
        }
        if (
            (accessory == 4 || accessory == 6 || accessory == 7 || accessory == 8) &&
            (clothes == 1 || clothes == 2 || clothes == 3 || clothes == 8 || clothes == 11)
        ) {
            return false;
        }
        if (breed == 15 && (accessory == 4 || accessory == 6)) {
            return false;
        }
        return true;
    }

    function _isMoodAllowed(uint8 mouth, uint8 background, uint8 mood) private pure returns (bool) {
        if (mood == 3 && (mouth == 0 || mouth == 5)) return false;
        if (mood == 10 && background != 4 && background != 5) return false;
        return true;
    }

    function _isMarkAllowed(uint8 breed, uint8 clothes, uint8 marks) private pure returns (bool) {
        if ((breed == 15 || breed == 17 || breed == 19) && marks == 2) {
            return false;
        }
        if (clothes == 12) {
            return marks == 0 || marks == 1 || marks == 2;
        }
        return true;
    }

    function _roll20(uint16[20] memory weights, uint256 roll) private pure returns (uint8) {
        uint16 cursor;
        for (uint8 i = 0; i < 20; i++) {
            cursor += weights[i];
            if (roll < cursor) return i;
        }
        return 0;
    }

    function _roll12(uint16[12] memory weights, uint256 roll) private pure returns (uint8) {
        uint16 cursor;
        for (uint8 i = 0; i < 12; i++) {
            cursor += weights[i];
            if (roll < cursor) return i;
        }
        return 0;
    }

    function _kittySvg(KittyTraitIds memory ids, uint8) private view returns (string memory) {
        string memory svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32' shape-rendering='crispEdges'>";
        svg = string.concat(svg, _layerGroupSvg(backgroundSources[ids.background]));
        if (ids.mood != 4) {
            svg = string.concat(svg, _layerGroupSvg(moodSources[ids.mood]));
        }
        svg = string.concat(svg, _layerGroupSvg(breedSources[ids.breed]));
        if (ids.mood == 4) {
            svg = string.concat(svg, _layerGroupSvg(moodSources[ids.mood]));
        }
        svg = string.concat(svg, _layerGroupSvg(clothesSources[ids.clothes]));
        svg = string.concat(svg, _layerGroupSvg(markSources[ids.marks]));
        svg = string.concat(svg, _layerGroupSvg(mouthSources[ids.mouth]));
        svg = string.concat(svg, _layerGroupSvg(eyeSources[ids.eyes]));
        svg = string.concat(svg, _layerGroupSvg(accessorySources[ids.accessory]));
        return string.concat(svg, "</svg>");
    }

    function _layerGroupSvg(ArtSourceRef[] storage sources) private view returns (string memory) {
        string memory svg;
        for (uint256 i = 0; i < sources.length; i++) {
            svg = string.concat(svg, IKPEGArtLayerSource(sources[i].source).svg(sources[i].index));
        }
        return svg;
    }

    function _encode(KittyTraitIds memory ids) private pure returns (uint256 packed) {
        packed |= uint256(ids.background);
        packed |= uint256(ids.breed) << 8;
        packed |= uint256(ids.clothes) << 16;
        packed |= uint256(ids.mood) << 24;
        packed |= uint256(ids.marks) << 32;
        packed |= uint256(ids.mouth) << 40;
        packed |= uint256(ids.eyes) << 48;
        packed |= uint256(ids.accessory) << 56;
    }

    function _decode(uint256 packed) private pure returns (KittyTraitIds memory) {
        return KittyTraitIds({
            background: uint8(packed & 0xff),
            breed: uint8((packed >> 8) & 0xff),
            clothes: uint8((packed >> 16) & 0xff),
            mood: uint8((packed >> 24) & 0xff),
            marks: uint8((packed >> 32) & 0xff),
            mouth: uint8((packed >> 40) & 0xff),
            eyes: uint8((packed >> 48) & 0xff),
            accessory: uint8((packed >> 56) & 0xff)
        });
    }

    function _tierName(uint8 tier) private pure returns (string memory) {
        if (tier == 1) return "Uncommon";
        if (tier == 2) return "Rare";
        if (tier == 3) return "Epic";
        if (tier >= 4) return "Legendary";
        return "Common";
    }

    function _toString(uint256 value) private pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}
